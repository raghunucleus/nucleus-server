/**
 * NQL (Nucleus Query Language) tokenizer.
 *
 * Token stream for a JQL-style filter language:
 *   programme IN ("B.Tech CSE") AND ug_cgpa >= 7 ORDER BY ug_cgpa DESC
 *
 * Keywords are NOT distinguished here — AND/OR/IN/IS/... arrive as `ident`
 * tokens and the parser matches them case-insensitively, so a future
 * attribute named e.g. `order_count` never collides with a keyword.
 */

export class NqlError extends Error {
  constructor(
    message: string,
    /** 0-based character offset into the source string. */
    readonly position: number,
    /** Snippet of source around the error for UI display. */
    readonly near: string,
  ) {
    super(message);
    this.name = 'NqlError';
  }
}

export type TokenType =
  | 'ident'
  | 'number'
  | 'string'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof';

export interface Token {
  type: TokenType;
  /** Raw text for ident/op; unquoted content for string; numeric text for number. */
  value: string;
  pos: number;
}

const OPS = ['>=', '<=', '!=', '!~', '^=', '=', '>', '<', '~'] as const;

function isIdentStart(c: string): boolean {
  return /[A-Za-z_]/.test(c);
}
function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}
function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

export function nearOf(src: string, pos: number): string {
  return src.slice(Math.max(0, pos - 10), pos + 15);
}

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: '(', pos: i });
      i += 1;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: ')', pos: i });
      i += 1;
      continue;
    }
    if (c === ',') {
      tokens.push({ type: 'comma', value: ',', pos: i });
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i += 1;
      let out = '';
      while (i < src.length && src[i] !== quote) {
        out += src[i];
        i += 1;
      }
      if (i >= src.length) {
        throw new NqlError('Unterminated string.', start, nearOf(src, start));
      }
      i += 1; // closing quote
      tokens.push({ type: 'string', value: out, pos: start });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ type: 'op', value: op, pos: i });
      i += op.length;
      continue;
    }
    if (isDigit(c) || (c === '-' && isDigit(src[i + 1] ?? ''))) {
      const start = i;
      if (c === '-') i += 1;
      while (i < src.length && isDigit(src[i])) i += 1;
      if (src[i] === '.' && isDigit(src[i + 1] ?? '')) {
        i += 1;
        while (i < src.length && isDigit(src[i])) i += 1;
      }
      tokens.push({ type: 'number', value: src.slice(start, i), pos: start });
      continue;
    }
    if (isIdentStart(c)) {
      const start = i;
      while (i < src.length && isIdentPart(src[i])) i += 1;
      tokens.push({ type: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }
    throw new NqlError(`Unexpected character '${c}'.`, i, nearOf(src, i));
  }
  tokens.push({ type: 'eof', value: '', pos: src.length });
  return tokens;
}
