import {
  SearchCondition,
  SearchGroup,
  SearchNode,
} from '../dto/student-search.dto';
import { NqlError, Token, lex, nearOf } from './lexer';

/**
 * NQL recursive-descent parser. Text -> the same filter AST the structured
 * `filters` body uses, plus an optional trailing ORDER BY. Semantic checks
 * (unknown attribute, operator/kind mismatch, FK label resolution) are NOT
 * done here — the engine applies them identically to both input forms.
 *
 * Grammar:
 *   query     := orExpr? ('ORDER' 'BY' ident ('ASC'|'DESC')?)? EOF
 *   orExpr    := andExpr ('OR' andExpr)*
 *   andExpr   := term ('AND' term)*
 *   term      := '(' orExpr ')' | condition
 *   condition := attr op value
 *              | attr 'BETWEEN' value 'AND' value
 *              | attr ('IN' | 'NOT' 'IN') '(' value (',' value)* ')'
 *              | attr 'IS' 'NOT'? 'NULL'
 *   attr      := ident ('(' value (',' value)* ')')?   // parameterized attrs
 *   op        := '=' '!=' '>' '>=' '<' '<=' '~' '!~' '^='
 *   value     := string | number | 'true' | 'false'
 */

export interface ParsedNql {
  filters?: SearchGroup;
  sort?: { by: string; dir: 'asc' | 'desc' };
}

const OP_MAP: Record<string, SearchCondition['op']> = {
  '=': 'eq',
  '!=': 'neq',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  '~': 'contains',
  '!~': 'not_contains',
  '^=': 'starts_with',
};

/** Positional args from `attr(...)` call syntax — the engine maps them onto
 *  the attribute's declared argNames. */
export const NQL_POSITIONAL_ARGS = '__nql_positional';

class Parser {
  private i = 0;

  constructor(
    private readonly src: string,
    private readonly tokens: Token[],
  ) {}

  parse(): ParsedNql {
    const out: ParsedNql = {};
    if (!this.atKeyword('ORDER') && this.peek().type !== 'eof') {
      const root = this.parseOr();
      // Normalize a bare condition / OR group to the canonical {and:[...]} root.
      out.filters = 'attr' in root ? { and: [root] } : root;
    }
    if (this.atKeyword('ORDER')) {
      this.next();
      this.expectKeyword('BY');
      const attr = this.expect('ident', 'a sortable attribute name');
      let dir: 'asc' | 'desc' = 'asc';
      if (this.atKeyword('ASC')) {
        this.next();
      } else if (this.atKeyword('DESC')) {
        this.next();
        dir = 'desc';
      }
      out.sort = { by: attr.value, dir };
    }
    const end = this.peek();
    if (end.type !== 'eof') {
      throw this.err(`Unexpected '${end.value}'.`, end);
    }
    return out;
  }

  private parseOr(): SearchNode {
    const parts: SearchNode[] = [this.parseAnd()];
    while (this.atKeyword('OR')) {
      this.next();
      parts.push(this.parseAnd());
    }
    return parts.length === 1 ? parts[0] : { or: parts };
  }

  private parseAnd(): SearchNode {
    const parts: SearchNode[] = [this.parseTerm()];
    while (this.atKeyword('AND')) {
      this.next();
      parts.push(this.parseTerm());
    }
    return parts.length === 1 ? parts[0] : { and: parts };
  }

  private parseTerm(): SearchNode {
    if (this.peek().type === 'lparen') {
      this.next();
      const inner = this.parseOr();
      this.expect('rparen', "')'");
      // A parenthesized single condition needs no group wrapper.
      return inner;
    }
    return this.parseCondition();
  }

  private parseCondition(): SearchCondition {
    const attrTok = this.expect('ident', 'an attribute name');
    const attr = attrTok.value;
    let args: Record<string, unknown> | undefined;

    if (this.peek().type === 'lparen') {
      this.next();
      const positional: unknown[] = [this.parseValue()];
      while (this.peek().type === 'comma') {
        this.next();
        positional.push(this.parseValue());
      }
      this.expect('rparen', "')'");
      args = { [NQL_POSITIONAL_ARGS]: positional };
    }

    const t = this.peek();
    if (t.type === 'op') {
      this.next();
      const value = this.parseValue();
      return { attr, op: OP_MAP[t.value], value, args };
    }
    if (this.atKeyword('BETWEEN')) {
      this.next();
      const lo = this.parseValue();
      this.expectKeyword('AND');
      const hi = this.parseValue();
      return { attr, op: 'between', value: [lo, hi], args };
    }
    if (this.atKeyword('IN')) {
      this.next();
      return { attr, op: 'in', value: this.parseValueList(), args };
    }
    if (this.atKeyword('NOT')) {
      this.next();
      this.expectKeyword('IN');
      return { attr, op: 'not_in', value: this.parseValueList(), args };
    }
    if (this.atKeyword('IS')) {
      this.next();
      if (this.atKeyword('NOT')) {
        this.next();
        this.expectKeyword('NULL');
        return { attr, op: 'not_null', args };
      }
      this.expectKeyword('NULL');
      return { attr, op: 'is_null', args };
    }
    throw this.err(
      `Expected an operator after '${attr}' (=, !=, >, >=, <, <=, ~, !~, ^=, IN, NOT IN, BETWEEN, IS NULL).`,
      t,
    );
  }

  private parseValueList(): unknown[] {
    this.expect('lparen', "'('");
    const values: unknown[] = [this.parseValue()];
    while (this.peek().type === 'comma') {
      this.next();
      values.push(this.parseValue());
    }
    this.expect('rparen', "')'");
    return values;
  }

  private parseValue(): unknown {
    const t = this.peek();
    if (t.type === 'string') {
      this.next();
      return t.value;
    }
    if (t.type === 'number') {
      this.next();
      return Number(t.value);
    }
    if (this.atKeyword('TRUE')) {
      this.next();
      return true;
    }
    if (this.atKeyword('FALSE')) {
      this.next();
      return false;
    }
    throw this.err(
      `Expected a value (quoted string, number, true or false), got '${t.value || 'end of query'}'.`,
      t,
    );
  }

  // -- token helpers --------------------------------------------------------

  private peek(): Token {
    return this.tokens[this.i];
  }

  private next(): Token {
    const t = this.tokens[this.i];
    this.i += 1;
    return t;
  }

  private atKeyword(kw: string): boolean {
    const t = this.peek();
    return t.type === 'ident' && t.value.toUpperCase() === kw;
  }

  private expectKeyword(kw: string): void {
    if (!this.atKeyword(kw)) {
      const t = this.peek();
      throw this.err(
        `Expected '${kw}', got '${t.value || 'end of query'}'.`,
        t,
      );
    }
    this.next();
  }

  private expect(type: Token['type'], what: string): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw this.err(
        `Expected ${what}, got '${t.value || 'end of query'}'.`,
        t,
      );
    }
    return this.next();
  }

  private err(message: string, at: Token): NqlError {
    return new NqlError(message, at.pos, nearOf(this.src, at.pos));
  }
}

export function parseNql(src: string): ParsedNql {
  return new Parser(src, lex(src)).parse();
}

export { NqlError };
