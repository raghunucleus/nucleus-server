import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  Repository,
  WhereExpressionBuilder,
} from 'typeorm';
import { Student } from '../admin/entities/student.entity';
import { ACCESS_ALL, AccessibleIds } from '../rbac/permissions.service';
import {
  MAX_IN_VALUES,
  SearchCondition,
  SearchGroup,
  SearchNode,
  StudentSearchDto,
  StudentSearchResult,
  isGroupNode,
} from './dto/student-search.dto';
import { NQL_POSITIONAL_ARGS, NqlError, parseNql } from './nql/parser';
import { JOINS, expandJoins } from './registry/joins';
import {
  ATTRIBUTE_BY_KEY,
  ATTRIBUTE_GROUPS,
  DEFAULT_COLUMNS,
  DEFAULT_SORT,
  IMPLICIT_COLUMNS,
  SEARCH_ATTRIBUTES,
  STUDENT_ATTRIBUTES,
  operatorsFor,
} from './registry/student-attributes';
import {
  AttributeDef,
  FK_LOOKUPS,
  JoinId,
  Operator,
  Surface,
  isExistsFacet,
  isHydrateFacet,
  isSqlFacet,
  isSubqueryFacet,
} from './registry/types';

export interface StudentQueryScope {
  departmentIds?: AccessibleIds;
  programmeIds?: AccessibleIds;
  admissionYearIds?: AccessibleIds;
  attendanceGroupIds?: AccessibleIds;
}

export interface StudentQueryOptions {
  surface: Surface;
  /** RBAC pre-filters (employee surface). Applied before user filters and
   *  never overridable by them. */
  scope?: StudentQueryScope;
}

/** Hard ceiling for skip_pagination result sets. */
const MAX_UNPAGINATED = 100_000;

interface ValidationIssue {
  path: string;
  message: string;
}

/** Mutable state threaded through query assembly. */
interface BuildCtx {
  n: number;
  params: Record<string, unknown>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

@Injectable()
export class StudentQueryService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------------
  // Meta — everything a UI needs to render a filter builder + NQL editor.
  // ---------------------------------------------------------------------

  meta(surface: Surface) {
    const attributes = STUDENT_ATTRIBUTES.filter(
      (a) => !a.surfaces || a.surfaces.includes(surface),
    ).map((a) => ({
      key: a.key,
      label: a.label,
      group: a.group,
      kind: a.kind,
      operators: operatorsFor(a),
      filterable: !!a.filter,
      selectable: !!a.select,
      sortable: !!a.sort,
      enumValues: a.enumValues ?? null,
      enumLabels: a.enumLabels ?? null,
      fkLookup: a.fkLookup ?? null,
      args: a.argNames ?? null,
    }));
    return {
      groups: ATTRIBUTE_GROUPS,
      attributes,
      searchFields: SEARCH_ATTRIBUTES,
      implicitColumns: IMPLICIT_COLUMNS,
      defaultColumns: DEFAULT_COLUMNS,
      defaultSort: DEFAULT_SORT,
      maxPageSize: 100,
      maxPage: 400,
      nql: {
        operators: {
          '=': 'eq',
          '!=': 'neq',
          '>': 'gt',
          '>=': 'gte',
          '<': 'lt',
          '<=': 'lte',
          '~': 'contains',
          '!~': 'not_contains',
          '^=': 'starts_with',
          'IN (...)': 'in',
          'NOT IN (...)': 'not_in',
          'BETWEEN x AND y': 'between',
          'IS NULL': 'is_null',
          'IS NOT NULL': 'not_null',
        },
        examples: [
          'ug_cgpa >= 7 AND current_backlogs = 0 ORDER BY ug_cgpa DESC',
          'programme IN ("B.Tech CSE", "B.Tech ECE") AND gender = "female"',
          'display_name ~ "reddy" AND pass_out_year = 2026',
          '(twelfth_percentage >= 60 OR diploma_percentage >= 60) AND entry_type = "Regular"',
        ],
      },
    };
  }

  /**
   * Options for one fk-kind attribute's value picker — id/label rows from the
   * registry's lookup table, optionally narrowed by a contains match. The
   * table/label identifiers come from `FK_LOOKUPS` (compile-time registry
   * constants, same trust model as `resolveFkLabels`), never from user input.
   */
  async fkOptions(
    lookup: string,
    q?: string,
  ): Promise<Array<{ id: number; label: string }>> {
    const cfg = FK_LOOKUPS[lookup as keyof typeof FK_LOOKUPS];
    if (!cfg) {
      throw new BadRequestException(`Unknown lookup "${lookup}".`);
    }
    const where = q?.trim() ? `WHERE ${cfg.label} ILIKE $1 ESCAPE '\\'` : '';
    const params = q?.trim() ? [`%${escapeLike(q.trim())}%`] : [];
    const rows: Array<{ id: number; label: string }> =
      await this.dataSource.query(
        `SELECT id, ${cfg.label} AS label FROM ${cfg.table} ${where} ORDER BY ${cfg.label} ASC LIMIT 200`,
        params,
      );
    return rows.map((r) => ({ id: Number(r.id), label: r.label }));
  }

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------

  /**
   * Compile an NQL string to the shared filter AST (plus any trailing ORDER BY),
   * exactly as {@link search} does internally. Used by the clients' Filters/NQL
   * sync so the visual builder can round-trip a query without a second grammar
   * living in the frontend. Syntax errors surface as a 400; no semantic
   * validation (unknown attribute, operator/kind mismatch) is done here — the
   * real search call still validates.
   */
  parseNqlQuery(nql: string): {
    filters?: SearchGroup;
    sort?: { by: string; dir: 'asc' | 'desc' };
  } {
    try {
      return parseNql(nql);
    } catch (e) {
      if (e instanceof NqlError) {
        throw new BadRequestException({
          message: `NQL: ${e.message}`,
          position: e.position,
          near: e.near,
        });
      }
      throw e;
    }
  }

  async search(
    dto: StudentSearchDto,
    opts: StudentQueryOptions,
  ): Promise<StudentSearchResult> {
    const { surface, scope } = opts;

    // RBAC three-state contract: an empty accessible list means "no access" —
    // return an empty page without touching the database.
    for (const ids of Object.values(scope ?? {})) {
      if (ids !== undefined && ids !== ACCESS_ALL && ids.length === 0) {
        return this.emptyResult(dto);
      }
    }

    // NQL text -> shared AST (structured `filters` is already in it).
    let filters = dto.filters as SearchGroup | undefined;
    let sortInput = dto.sort;
    if (dto.nql) {
      let parsed;
      try {
        parsed = parseNql(dto.nql);
      } catch (e) {
        if (e instanceof NqlError) {
          throw new BadRequestException({
            message: `NQL: ${e.message}`,
            position: e.position,
            near: e.near,
          });
        }
        throw e;
      }
      filters = parsed.filters;
      if (parsed.sort) {
        if (sortInput) {
          throw new BadRequestException({
            message:
              'Sort specified twice — use either NQL ORDER BY or the "sort" field, not both.',
          });
        }
        sortInput = parsed.sort;
      }
    }

    // Semantic validation (aggregated) + FK/enum label resolution.
    const issues: ValidationIssue[] = [];
    const columns = this.resolveColumns(dto.columns, surface, issues);
    const sort = this.resolveSort(sortInput, surface, issues);
    if (filters) {
      this.validateNode(filters, surface, 'filters', 1, issues);
    }
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Invalid search request.',
        errors: issues,
      });
    }
    if (filters) {
      await this.resolveFkLabels(filters);
    }

    return dto.skip_pagination
      ? this.searchAll(dto, filters, columns, sort, scope)
      : this.searchPage(dto, filters, columns, sort, scope);
  }

  // ---------------------------------------------------------------------
  // Paginated path: count -> ordered id page -> hydrate.
  // ---------------------------------------------------------------------

  private async searchPage(
    dto: StudentSearchDto,
    filters: SearchGroup | undefined,
    columns: AttributeDef[],
    sort: { def: AttributeDef; dir: 'asc' | 'desc' },
    scope?: StudentQueryScope,
  ): Promise<StudentSearchResult> {
    // The filter query is join-free by design (filter facets use local
    // columns, IN-subqueries or EXISTS probes) — it scans only `students`.
    const filterQb = this.buildFilterQb(dto, filters, scope);

    const countRaw = await filterQb
      .clone()
      .select('COUNT(*)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(countRaw?.cnt ?? 0);
    const pageCount = Math.max(1, Math.ceil(total / dto.pageSize));

    if (total === 0) {
      return { ...this.emptyResult(dto), total: 0 };
    }

    // Ordered id page. Sorting by a joined label is the one case where a
    // (to-one) join reaches this query.
    const idQb = filterQb.clone();
    const sortJoins = expandJoins(sort.def.sort?.joins ?? []);
    this.applyJoins(idQb, sortJoins);
    const multiplying = sortJoins.some((j) => JOINS[j].multiplying);
    if (multiplying) idQb.distinct(true);
    const sortExpr = sort.def.sort!.expr;
    const dir = sort.dir === 'asc' ? 'ASC' : 'DESC';
    const idRows = await idQb
      .select('s.id', 'id')
      .addSelect(sortExpr, 'sort_val')
      .orderBy(sortExpr, dir, 'NULLS LAST')
      .addOrderBy('s.id', 'ASC')
      .offset((dto.page - 1) * dto.pageSize)
      .limit(dto.pageSize)
      .getRawMany<{ id: number }>();
    const pageIds = idRows.map((r) => Number(r.id));

    if (pageIds.length === 0) {
      return { ...this.emptyResult(dto), total, pageCount };
    }

    const rows = await this.hydrate(pageIds, columns);
    return {
      rows,
      total,
      page: dto.page,
      pageSize: dto.pageSize,
      pageCount,
      columns: this.columnKeys(columns),
    };
  }

  // ---------------------------------------------------------------------
  // skip_pagination path: one query with label joins added directly (all
  // select joins are to-one, so rows never multiply).
  // ---------------------------------------------------------------------

  private async searchAll(
    dto: StudentSearchDto,
    filters: SearchGroup | undefined,
    columns: AttributeDef[],
    sort: { def: AttributeDef; dir: 'asc' | 'desc' },
    scope?: StudentQueryScope,
  ): Promise<StudentSearchResult> {
    const countRaw = await this.buildFilterQb(dto, filters, scope)
      .select('COUNT(*)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(countRaw?.cnt ?? 0);
    if (total > MAX_UNPAGINATED) {
      throw new BadRequestException({
        message: `Result set too large for skip_pagination (${total} rows, max ${MAX_UNPAGINATED}). Narrow the filters.`,
      });
    }
    if (total === 0) {
      return { ...this.emptyResult(dto), pageSize: 0 };
    }

    const qb = this.buildFilterQb(dto, filters, scope);
    const joinIds = new Set<JoinId>(sort.def.sort?.joins ?? []);
    for (const def of columns) {
      const sel = def.select!;
      if (!isHydrateFacet(sel)) {
        for (const j of sel.joins ?? []) joinIds.add(j);
      }
    }
    this.applyJoins(qb, expandJoins(joinIds));
    this.applyRawSelect(qb, columns);
    const dir = sort.dir === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(sort.def.sort!.expr, dir, 'NULLS LAST').addOrderBy(
      's.id',
      'ASC',
    );
    const raw = await qb.getRawMany<Record<string, unknown>>();
    const rows = this.mapRows(raw, columns);
    await this.runHydrators(
      rows.map((r) => Number(r.id)),
      rows,
      columns,
    );
    return {
      rows,
      total,
      page: 1,
      pageSize: rows.length,
      pageCount: 1,
      columns: this.columnKeys(columns),
    };
  }

  // ---------------------------------------------------------------------
  // Query assembly
  // ---------------------------------------------------------------------

  /** Filters + scope + free-text search on `students` alone — no joins. */
  private buildFilterQb(
    dto: StudentSearchDto,
    filters: SearchGroup | undefined,
    scope?: StudentQueryScope,
  ) {
    const qb = this.students.createQueryBuilder('s');
    const ctx: BuildCtx = { n: 0, params: {} };

    if (scope?.programmeIds && scope.programmeIds !== ACCESS_ALL) {
      qb.andWhere(
        `s.programme_id IN (:...${this.param(ctx, scope.programmeIds)})`,
      );
    }
    if (scope?.admissionYearIds && scope.admissionYearIds !== ACCESS_ALL) {
      qb.andWhere(
        `s.admission_year_id IN (:...${this.param(ctx, scope.admissionYearIds)})`,
      );
    }
    if (scope?.departmentIds && scope.departmentIds !== ACCESS_ALL) {
      qb.andWhere(
        `s.programme_id IN (SELECT sc_p.id FROM programmes sc_p WHERE sc_p.department_id IN (:...${this.param(ctx, scope.departmentIds)}))`,
      );
    }
    if (scope?.attendanceGroupIds && scope.attendanceGroupIds !== ACCESS_ALL) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM student_groups sc_sg WHERE sc_sg.student_id = s.id AND sc_sg.attendance_group_id IN (:...${this.param(ctx, scope.attendanceGroupIds)}))`,
      );
    }

    if (filters) {
      qb.andWhere(new Brackets((w) => this.applyGroup(w, filters, ctx)));
    }

    if (dto.search) {
      const p = this.param(ctx, `%${escapeLike(dto.search)}%`);
      qb.andWhere(
        new Brackets((w) => {
          for (const key of SEARCH_ATTRIBUTES) {
            w.orWhere(`s.${key} ILIKE :${p} ESCAPE '\\'`);
          }
        }),
      );
    }

    qb.setParameters(ctx.params);
    return qb;
  }

  private applyGroup(
    w: WhereExpressionBuilder,
    group: SearchGroup,
    ctx: BuildCtx,
  ): void {
    const nodes = group.and ?? group.or ?? [];
    const isAnd = group.and !== undefined;
    for (const node of nodes) {
      const bracket = new Brackets((inner) => {
        if (isGroupNode(node)) this.applyGroup(inner, node, ctx);
        else inner.where(this.conditionSql(node, ctx));
      });
      if (isAnd) w.andWhere(bracket);
      else w.orWhere(bracket);
    }
  }

  private conditionSql(cond: SearchCondition, ctx: BuildCtx): string {
    const def = ATTRIBUTE_BY_KEY.get(cond.attr)!;
    const facet = def.filter!;

    if (isSqlFacet(facet)) {
      return this.opSql(facet.expr, cond.op, cond.value, ctx);
    }
    if (isSubqueryFacet(facet)) {
      const sq = facet.subquery;
      return `${sq.local} IN (SELECT ${sq.select} FROM ${sq.table} ${sq.alias} WHERE ${this.opSql(sq.valueExpr, cond.op, cond.value, ctx)})`;
    }
    if (isExistsFacet(facet)) {
      const ex = facet.exists;
      const argClauses = (def.argNames ?? []).map((name) => {
        const template = ex.argWhere?.[name];
        const p = this.param(ctx, (cond.args as Record<string, unknown>)[name]);
        return ` AND ${template!.replace(':ARG', `:${p}`)}`;
      });
      const base = `SELECT 1 FROM ${ex.table} ${ex.alias}${ex.join ? ` ${ex.join}` : ''} WHERE ${ex.correlation}${argClauses.join('')}`;
      switch (cond.op) {
        case 'not_in': {
          const p = this.param(ctx, cond.value);
          return `NOT EXISTS (${base} AND ${ex.valueExpr} IN (:...${p}))`;
        }
        case 'is_null':
          return `NOT EXISTS (${base} AND ${ex.valueExpr} IS NOT NULL)`;
        case 'not_null':
          return `EXISTS (${base} AND ${ex.valueExpr} IS NOT NULL)`;
        default:
          return `EXISTS (${base} AND ${this.opSql(ex.valueExpr, cond.op, cond.value, ctx)})`;
      }
    }
    throw new Error(`Unhandled filter facet for '${cond.attr}'`);
  }

  private opSql(
    expr: string,
    op: Operator,
    value: unknown,
    ctx: BuildCtx,
  ): string {
    switch (op) {
      case 'eq':
        return `${expr} = :${this.param(ctx, value)}`;
      case 'neq':
        return `${expr} != :${this.param(ctx, value)}`;
      case 'in':
        return `${expr} IN (:...${this.param(ctx, value)})`;
      case 'not_in':
        return `${expr} NOT IN (:...${this.param(ctx, value)})`;
      case 'gt':
        return `${expr} > :${this.param(ctx, value)}`;
      case 'gte':
        return `${expr} >= :${this.param(ctx, value)}`;
      case 'lt':
        return `${expr} < :${this.param(ctx, value)}`;
      case 'lte':
        return `${expr} <= :${this.param(ctx, value)}`;
      case 'between': {
        const [lo, hi] = value as [unknown, unknown];
        return `${expr} BETWEEN :${this.param(ctx, lo)} AND :${this.param(ctx, hi)}`;
      }
      case 'contains':
        return `${expr} ILIKE :${this.param(ctx, `%${escapeLike(String(value))}%`)} ESCAPE '\\'`;
      case 'not_contains':
        return `${expr} NOT ILIKE :${this.param(ctx, `%${escapeLike(String(value))}%`)} ESCAPE '\\'`;
      case 'starts_with':
        return `${expr} ILIKE :${this.param(ctx, `${escapeLike(String(value))}%`)} ESCAPE '\\'`;
      case 'is_null':
        return `${expr} IS NULL`;
      case 'not_null':
        return `${expr} IS NOT NULL`;
    }
  }

  private param(ctx: BuildCtx, value: unknown): string {
    const name = `p${ctx.n}`;
    ctx.n += 1;
    ctx.params[name] = value;
    return name;
  }

  private applyJoins(
    qb: ReturnType<Repository<Student>['createQueryBuilder']>,
    joinIds: JoinId[],
  ): void {
    for (const id of joinIds) {
      const def = JOINS[id];
      qb.leftJoin(def.entity() as never, def.alias, def.on);
    }
  }

  // ---------------------------------------------------------------------
  // Hydration & row mapping
  // ---------------------------------------------------------------------

  private async hydrate(
    pageIds: number[],
    columns: AttributeDef[],
  ): Promise<Array<Record<string, unknown>>> {
    const qb = this.students
      .createQueryBuilder('s')
      .where('s.id IN (:...ids)', { ids: pageIds });
    const joinIds = new Set<JoinId>();
    for (const def of columns) {
      const sel = def.select!;
      if (!isHydrateFacet(sel)) {
        for (const j of sel.joins ?? []) joinIds.add(j);
      }
    }
    this.applyJoins(qb, expandJoins(joinIds));
    this.applyRawSelect(qb, columns);
    const raw = await qb.getRawMany<Record<string, unknown>>();

    // Restore the id-page order (WHERE ... IN has no ordering guarantee).
    const byId = new Map(raw.map((r) => [Number(r.id), r]));
    const ordered = pageIds
      .map((id) => byId.get(id))
      .filter((r): r is Record<string, unknown> => !!r);
    const rows = this.mapRows(ordered, columns);
    await this.runHydrators(pageIds, rows, columns);
    return rows;
  }

  private applyRawSelect(
    qb: ReturnType<Repository<Student>['createQueryBuilder']>,
    columns: AttributeDef[],
  ): void {
    qb.select('s.id', 'id')
      .addSelect('s.student_id', 'student_id')
      .addSelect('s.display_name', 'display_name');
    for (const def of columns) {
      if ((IMPLICIT_COLUMNS as readonly string[]).includes(def.key)) continue;
      const sel = def.select!;
      if (isHydrateFacet(sel)) continue; // filled by runHydrators
      qb.addSelect(sel.expr, def.key);
    }
  }

  /** Type-map raw values: numeric strings -> numbers, per registry kind. */
  private mapRows(
    raw: Array<Record<string, unknown>>,
    columns: AttributeDef[],
  ): Array<Record<string, unknown>> {
    const numberKeys = columns
      .filter((c) => c.kind === 'number')
      .map((c) => c.key);
    return raw.map((r) => {
      const row: Record<string, unknown> = { ...r, id: Number(r.id) };
      for (const key of numberKeys) {
        if (row[key] !== null && row[key] !== undefined) {
          row[key] = Number(row[key]);
        }
      }
      return row;
    });
  }

  /** Page-level multi-value hydrators (never row-multiplying joins). */
  private async runHydrators(
    ids: number[],
    rows: Array<Record<string, unknown>>,
    columns: AttributeDef[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const wantsCerts = columns.some(
      (c) => c.select && isHydrateFacet(c.select),
    );
    if (!wantsCerts) return;
    const certRows: Array<{ student_id: number; name: string }> =
      await this.dataSource.query(
        `SELECT sic.student_id, ic.name
           FROM student_industry_certifications sic
           JOIN industry_certifications ic ON ic.id = sic.industry_certification_id
          WHERE sic.student_id = ANY($1)
          ORDER BY ic.name`,
        [ids],
      );
    const byStudent = new Map<number, string[]>();
    for (const r of certRows) {
      const list = byStudent.get(Number(r.student_id)) ?? [];
      list.push(r.name);
      byStudent.set(Number(r.student_id), list);
    }
    for (const row of rows) {
      row.industry_certifications = byStudent.get(Number(row.id)) ?? [];
    }
  }

  // ---------------------------------------------------------------------
  // Semantic validation
  // ---------------------------------------------------------------------

  private resolveColumns(
    requested: string[] | undefined,
    surface: Surface,
    issues: ValidationIssue[],
  ): AttributeDef[] {
    const keys = requested?.length
      ? [...new Set(requested)]
      : [...DEFAULT_COLUMNS];
    const out: AttributeDef[] = [];
    for (const key of keys) {
      if ((IMPLICIT_COLUMNS as readonly string[]).includes(key)) continue;
      const def = ATTRIBUTE_BY_KEY.get(key);
      if (!def || (def.surfaces && !def.surfaces.includes(surface))) {
        issues.push({
          path: `columns.${key}`,
          message: `Unknown column '${key}'.`,
        });
        continue;
      }
      if (!def.select) {
        issues.push({
          path: `columns.${key}`,
          message: `'${key}' is not selectable.`,
        });
        continue;
      }
      out.push(def);
    }
    return out;
  }

  private resolveSort(
    sort: { by: string; dir: 'asc' | 'desc' } | undefined,
    surface: Surface,
    issues: ValidationIssue[],
  ): { def: AttributeDef; dir: 'asc' | 'desc' } {
    const by = sort?.by ?? DEFAULT_SORT.by;
    const dir = sort?.dir ?? DEFAULT_SORT.dir;
    const def = ATTRIBUTE_BY_KEY.get(by);
    if (!def || (def.surfaces && !def.surfaces.includes(surface))) {
      issues.push({
        path: 'sort.by',
        message: `Unknown sort attribute '${by}'.`,
      });
      return { def: ATTRIBUTE_BY_KEY.get(DEFAULT_SORT.by)!, dir };
    }
    if (!def.sort) {
      issues.push({ path: 'sort.by', message: `'${by}' is not sortable.` });
      return { def: ATTRIBUTE_BY_KEY.get(DEFAULT_SORT.by)!, dir };
    }
    return { def, dir };
  }

  private validateNode(
    node: SearchNode,
    surface: Surface,
    path: string,
    depth: number,
    issues: ValidationIssue[],
  ): void {
    if (isGroupNode(node)) {
      const children = node.and ?? node.or ?? [];
      const label = node.and ? 'and' : 'or';
      children.forEach((child, i) =>
        this.validateNode(
          child,
          surface,
          `${path}.${label}[${i}]`,
          depth + 1,
          issues,
        ),
      );
      return;
    }
    this.validateCondition(node, surface, path, issues);
  }

  private validateCondition(
    cond: SearchCondition,
    surface: Surface,
    path: string,
    issues: ValidationIssue[],
  ): void {
    const def = ATTRIBUTE_BY_KEY.get(cond.attr);
    if (!def || (def.surfaces && !def.surfaces.includes(surface))) {
      issues.push({ path, message: `Unknown attribute '${cond.attr}'.` });
      return;
    }
    if (!def.filter) {
      issues.push({ path, message: `'${cond.attr}' is not filterable.` });
      return;
    }
    if (!operatorsFor(def).includes(cond.op)) {
      issues.push({
        path,
        message: `Operator '${cond.op}' is not allowed for '${cond.attr}' (allowed: ${operatorsFor(def).join(', ')}).`,
      });
      return;
    }

    // Args: map NQL positional args onto declared names; reject stray args.
    const positional = (cond.args?.[NQL_POSITIONAL_ARGS] ?? undefined) as
      | unknown[]
      | undefined;
    if (def.argNames?.length) {
      if (positional) {
        if (positional.length !== def.argNames.length) {
          issues.push({
            path,
            message: `'${cond.attr}' takes ${def.argNames.length} argument(s) (${def.argNames.join(', ')}).`,
          });
          return;
        }
        cond.args = Object.fromEntries(
          def.argNames.map((name, i) => [name, positional[i]]),
        );
      }
      for (const name of def.argNames) {
        if (cond.args?.[name] === undefined) {
          issues.push({
            path,
            message: `'${cond.attr}' requires argument '${name}'.`,
          });
          return;
        }
      }
    } else if (positional || (cond.args && Object.keys(cond.args).length > 0)) {
      issues.push({ path, message: `'${cond.attr}' does not take arguments.` });
      return;
    }

    // Value shape per operator.
    if (cond.op === 'is_null' || cond.op === 'not_null') {
      if (cond.value !== undefined) {
        issues.push({ path, message: `'${cond.op}' takes no value.` });
      }
      return;
    }
    if (cond.op === 'in' || cond.op === 'not_in') {
      if (!Array.isArray(cond.value) || cond.value.length === 0) {
        issues.push({ path, message: `'${cond.op}' needs a non-empty array.` });
        return;
      }
      if (cond.value.length > MAX_IN_VALUES) {
        issues.push({
          path,
          message: `'${cond.op}' allows at most ${MAX_IN_VALUES} values.`,
        });
        return;
      }
      cond.value = cond.value.map((v, i) =>
        this.coerceValue(def, v, `${path}.value[${i}]`, issues),
      );
      return;
    }
    if (cond.op === 'between') {
      if (!Array.isArray(cond.value) || cond.value.length !== 2) {
        issues.push({
          path,
          message: `'between' needs a two-element [low, high] array.`,
        });
        return;
      }
      cond.value = cond.value.map((v, i) =>
        this.coerceValue(def, v, `${path}.value[${i}]`, issues),
      );
      return;
    }
    if (cond.value === undefined) {
      issues.push({ path, message: `'${cond.op}' needs a value.` });
      return;
    }
    cond.value = this.coerceValue(def, cond.value, `${path}.value`, issues);
  }

  private coerceValue(
    def: AttributeDef,
    value: unknown,
    path: string,
    issues: ValidationIssue[],
  ): unknown {
    switch (def.kind) {
      case 'string':
        if (typeof value !== 'string') {
          issues.push({ path, message: `'${def.key}' expects a string.` });
        }
        return value;
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        if (typeof value === 'boolean' || Number.isNaN(n)) {
          issues.push({ path, message: `'${def.key}' expects a number.` });
          return value;
        }
        return n;
      }
      case 'boolean':
        if (typeof value !== 'boolean') {
          issues.push({ path, message: `'${def.key}' expects true or false.` });
        }
        return value;
      case 'date':
        if (typeof value !== 'string' || !DATE_RE.test(value)) {
          issues.push({
            path,
            message: `'${def.key}' expects a YYYY-MM-DD date string.`,
          });
        }
        return value;
      case 'enum': {
        if (def.enumValues!.includes(value as string | number)) return value;
        // Accept labels case-insensitively: entry_type = "Lateral" -> 2.
        if (typeof value === 'string' && def.enumLabels) {
          const hit = Object.entries(def.enumLabels).find(
            ([, label]) => label.toLowerCase() === value.toLowerCase(),
          );
          if (hit) {
            const raw = hit[0];
            return def.enumValues!.includes(Number(raw)) ? Number(raw) : raw;
          }
        }
        // Numeric enums arrive as strings from NQL ("2") — retry coerced.
        if (
          typeof value === 'string' &&
          def.enumValues!.includes(Number(value))
        ) {
          return Number(value);
        }
        issues.push({
          path,
          message: `'${def.key}' expects one of: ${def.enumValues!.join(', ')}.`,
        });
        return value;
      }
      case 'fk': {
        if (typeof value === 'number' && Number.isInteger(value)) return value;
        // Strings are label references — resolved in resolveFkLabels().
        if (typeof value === 'string' && value.trim() !== '') return value;
        issues.push({
          path,
          message: `'${def.key}' expects an id or a name string.`,
        });
        return value;
      }
    }
  }

  /**
   * Resolve string values on fk-kind conditions to ids by label, batched per
   * lookup table (one query each). Works identically for structured filters
   * and NQL — `programme IN ("B.Tech CSE", 4)` mixes freely.
   */
  private async resolveFkLabels(root: SearchGroup): Promise<void> {
    const wanted = new Map<string, Set<string>>(); // lookup -> lowercased labels
    const visit = (node: SearchNode): void => {
      if (isGroupNode(node)) {
        for (const child of [...(node.and ?? []), ...(node.or ?? [])])
          visit(child);
        return;
      }
      const def = ATTRIBUTE_BY_KEY.get(node.attr);
      if (def?.kind !== 'fk' || !def.fkLookup) return;
      const values = Array.isArray(node.value) ? node.value : [node.value];
      for (const v of values) {
        if (typeof v === 'string') {
          const set = wanted.get(def.fkLookup) ?? new Set<string>();
          set.add(v.toLowerCase());
          wanted.set(def.fkLookup, set);
        }
      }
    };
    visit(root);
    if (wanted.size === 0) return;

    const resolved = new Map<string, Map<string, number>>();
    await Promise.all(
      [...wanted.entries()].map(async ([lookup, labels]) => {
        const cfg = FK_LOOKUPS[lookup as keyof typeof FK_LOOKUPS];
        const rows: Array<{ id: number; label: string }> =
          await this.dataSource.query(
            `SELECT id, ${cfg.label} AS label FROM ${cfg.table} WHERE LOWER(${cfg.label}) = ANY($1)`,
            [[...labels]],
          );
        resolved.set(
          lookup,
          new Map(rows.map((r) => [r.label.toLowerCase(), Number(r.id)])),
        );
      }),
    );

    const issues: ValidationIssue[] = [];
    const rewrite = (node: SearchNode, path: string): void => {
      if (isGroupNode(node)) {
        const children = node.and ?? node.or ?? [];
        const label = node.and ? 'and' : 'or';
        children.forEach((child, i) =>
          rewrite(child, `${path}.${label}[${i}]`),
        );
        return;
      }
      const def = ATTRIBUTE_BY_KEY.get(node.attr);
      if (def?.kind !== 'fk' || !def.fkLookup) return;
      const map = resolved.get(def.fkLookup);
      const fix = (v: unknown): unknown => {
        if (typeof v !== 'string') return v;
        const id = map?.get(v.toLowerCase());
        if (id === undefined) {
          issues.push({
            path,
            message: `Unknown ${def.label.toLowerCase()}: "${v}".`,
          });
          return v;
        }
        return id;
      };
      node.value = Array.isArray(node.value)
        ? node.value.map(fix)
        : fix(node.value);
    };
    rewrite(root, 'filters');
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Invalid search request.',
        errors: issues,
      });
    }
  }

  // ---------------------------------------------------------------------

  private columnKeys(columns: AttributeDef[]): string[] {
    return [
      ...IMPLICIT_COLUMNS,
      ...columns
        .map((c) => c.key)
        .filter((k) => !(IMPLICIT_COLUMNS as readonly string[]).includes(k)),
    ];
  }

  private emptyResult(dto: StudentSearchDto): StudentSearchResult {
    const columns = this.resolveColumns(dto.columns, 'admin', []);
    return {
      rows: [],
      total: 0,
      page: dto.skip_pagination ? 1 : dto.page,
      pageSize: dto.skip_pagination ? 0 : dto.pageSize,
      pageCount: dto.skip_pagination ? 1 : 0,
      columns: this.columnKeys(columns),
    };
  }
}
