/**
 * Type system for the student query engine's attribute registry.
 *
 * Every filterable / selectable / sortable student attribute is declared as an
 * `AttributeDef` in student-attributes.ts. The engine never hardcodes a column
 * or a join — it reads facets off the registry, so adding an attribute (even a
 * deep one backed by another table) is a registry entry, not an engine change.
 *
 * Design invariant: FILTER facets are join-free. Flat columns filter on `s.*`,
 * one-hop FK attrs (department/degree) compile to an IN-subquery on the local
 * FK column, and child-table attrs compile to a correlated EXISTS. The count
 * and id-page queries therefore scan only `students`; joins exist solely for
 * select/sort label expressions.
 */

export const OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'not_contains',
  'starts_with',
  'is_null',
  'not_null',
] as const;
export type Operator = (typeof OPERATORS)[number];

export type AttrKind = 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'fk';

export const DEFAULT_OPERATORS: Record<AttrKind, readonly Operator[]> = {
  string: [
    'eq',
    'neq',
    'in',
    'not_in',
    'contains',
    'not_contains',
    'starts_with',
    'is_null',
    'not_null',
  ],
  number: [
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'in',
    'not_in',
    'is_null',
    'not_null',
  ],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'not_null'],
  boolean: ['eq', 'is_null', 'not_null'],
  enum: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
  fk: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
};

/** Ids of the label joins the engine may add for select/sort facets. */
export type JoinId =
  | 'programme'
  | 'department'
  | 'degree'
  | 'admission_year'
  | 'student_group'
  | 'att_group'
  | 'home_district'
  | 'home_state'
  | 'home_country'
  | 'entrance_exam'
  | 'tenth_board'
  | 'twelfth_board'
  | 'diploma_board'
  | 'tenth_state'
  | 'twelfth_state'
  | 'diploma_state';

export interface JoinDef {
  /** SQL alias, unique across the catalog. */
  alias: string;
  /** Lazy entity ref so the catalog file has no import cycles. */
  entity: () => Function;
  /** Raw ON condition, e.g. 'programme.id = s.programme_id'. */
  on: string;
  /** Transitive dependency (department/degree need programme, etc.). */
  dependsOn?: JoinId;
  /**
   * True would mean this join can produce >1 row per student. No v1 join does
   * — but the engine checks the flag and switches to COUNT(DISTINCT s.id) +
   * DISTINCT id pages if a future registry entry ever sets it, so a new join
   * can never silently corrupt totals.
   */
  multiplying?: boolean;
}

/** Plain SQL expression — the operator is applied to `expr` directly. */
export interface SqlFacet {
  expr: string;
  joins?: JoinId[];
}

/**
 * Join-free filter for attrs one FK hop away:
 *   `<local> IN (SELECT <select> FROM <table> <alias> WHERE <valueExpr> <op> :p)`
 * e.g. department: s.programme_id IN (SELECT p.id FROM programmes p WHERE p.department_id = :p)
 */
export interface SubqueryFacet {
  subquery: {
    local: string;
    table: string;
    alias: string;
    select: string;
    valueExpr: string;
  };
}

/**
 * Correlated EXISTS probe — membership and child-table attributes:
 *   `EXISTS (SELECT 1 FROM <table> <alias> WHERE <correlation> [AND argWhere] AND <valueExpr> <op> :p)`
 * `not_in` flips to NOT EXISTS with IN inside; `is_null` means "no matching
 * child row" (NOT EXISTS with valueExpr IS NOT NULL).
 *
 * `argWhere` templates support future parameterized attributes (sgpa(semester)):
 * each entry is `argName -> 'ssg.semester = :ARG'` where :ARG is replaced with
 * a numbered parameter holding args[argName].
 */
export interface ExistsFacet {
  exists: {
    table: string;
    alias: string;
    correlation: string;
    valueExpr: string;
    argWhere?: Record<string, string>;
  };
}

export type FilterFacet = SqlFacet | SubqueryFacet | ExistsFacet;

export function isSqlFacet(f: FilterFacet): f is SqlFacet {
  return 'expr' in f;
}
export function isSubqueryFacet(f: FilterFacet): f is SubqueryFacet {
  return 'subquery' in f;
}
export function isExistsFacet(f: FilterFacet): f is ExistsFacet {
  return 'exists' in f;
}

/**
 * Select facet: either a SQL expression (aliased to the attr key in the raw
 * select) or a named page-level hydrator for multi-value output (one extra
 * query per page, never a row-multiplying join).
 */
export type SelectFacet = SqlFacet | { hydrate: 'certifications' };

export function isHydrateFacet(
  f: SelectFacet,
): f is { hydrate: 'certifications' } {
  return 'hydrate' in f;
}

/** Well-known lookup sources for FK attrs — table + label column used both by
 *  NQL name resolution and by UIs to load filter options. */
export const FK_LOOKUPS = {
  programmes: { table: 'programmes', label: 'name' },
  departments: { table: 'departments', label: 'name' },
  degrees: { table: 'degrees', label: 'name' },
  admission_years: { table: 'admission_years', label: 'display_year' },
  attendance_groups: { table: 'attendance_groups', label: 'name' },
  districts: { table: 'districts', label: 'name' },
  states: { table: 'states', label: 'name' },
  countries: { table: 'countries', label: 'name' },
  entrance_exams: { table: 'entrance_exams', label: 'name' },
  school_boards_x: { table: 'school_boards_x', label: 'name' },
  school_boards_xii: { table: 'school_boards_xii', label: 'name' },
  diploma_boards: { table: 'diploma_boards', label: 'name' },
  industry_certifications: { table: 'industry_certifications', label: 'name' },
} as const;
export type FkLookup = keyof typeof FK_LOOKUPS;

export type Surface = 'admin' | 'employee';

export interface AttributeDef {
  /** Stable wire key — used in filters, columns, sort, NQL, and row output. */
  key: string;
  /** Human label — UI filter builder and CSV/XLSX column headers. */
  label: string;
  /** UI grouping key. */
  group: string;
  kind: AttrKind;
  /** Absent facet = attribute cannot be used that way (silently non-capable,
   *  loudly rejected by validation when a request tries). */
  filter?: FilterFacet;
  select?: SelectFacet;
  sort?: SqlFacet;
  /** Part of the fixed free-text search set. Must be a flat s.* string column. */
  searchable?: boolean;
  /** Allowed operators; defaults to DEFAULT_OPERATORS[kind]. */
  operators?: readonly Operator[];
  enumValues?: readonly (string | number)[];
  enumLabels?: Readonly<Record<string | number, string>>;
  fkLookup?: FkLookup;
  /**
   * Names of required args for parameterized attributes (future: sgpa(semester)).
   * Validated against the condition's `args`; each must have a matching
   * argWhere template on the exists facet.
   */
  argNames?: readonly string[];
  /** Endpoints that may see/use this attribute. Default: both surfaces. */
  surfaces?: readonly Surface[];
}

export interface AttributeGroupDef {
  key: string;
  label: string;
}
