/**
 * Static RBAC catalog types — the shape engineering uses to declare what
 * modules, role types, screens and attribute kinds exist in the system. The
 * catalog itself lives in sibling files (modules.ts, role-types.ts,
 * attribute-types.ts, screens.ts) and is validated at server boot.
 *
 * Composed roles in the database can only reference keys that exist here.
 */

export type Platform = 'web' | 'mobile' | 'both';

export interface ModuleDef {
  /** Stable identifier, e.g. "academics". Used as the FK in ScreenDef. */
  key: string;
  /** Human label shown in the menu. */
  label: string;
  /** Lucide icon name shared across admin-ui, nucleus-ui, and nucleus-mobile. */
  icon: string;
  /** Sort order in the employee menu. Lower comes first. */
  order: number;
}

export interface RoleTypeDef {
  /** Stable identifier, e.g. "hod". */
  key: string;
  /** Human label shown in the role-builder UI. */
  label: string;
  description?: string;
}

export interface AttributeTypeDef {
  /** Stable identifier, e.g. "ref:department". */
  key: string;
  /** Human label for the attribute kind. */
  label: string;
  /**
   * Informational tag — what backs this attribute. Free-form (entity name
   * for DB-backed types, or "enum"/"custom" for in-memory ones). The picker
   * does NOT use this; data comes from the matching fetcher registered in
   * `attribute-fetchers.ts`.
   */
  source: string;
}

export interface AttributeSchemaItem {
  /** Stable identifier within the screen, e.g. "department_id". */
  key: string;
  /** FK into AttributeTypeDef.key. */
  type: string;
  /** Human label shown in the assignment editor. */
  label: string;
  /** Block save if missing for this screen on an assignment. */
  required: boolean;
  /** Single value (scalar) vs. multi-select (array). */
  multi: boolean;
  /**
   * When `true`, the admin may set this attribute to the "all" wildcard
   * instead of picking specific values — meaning the assignment is not
   * scoped to specific ids and SHOULD include future entities of this type
   * (e.g. Principal seeing all departments, including any added later).
   *
   * Opt-in per attribute: some scopes must remain specific by design (e.g.
   * a single department_id for an HOD — an HOD is by definition tied to
   * one department, "all" is semantically wrong there).
   *
   * Storage: a wildcard value is stored on `role_assignment_attributes` as
   * the JSONB object `{ all: true }`. The `PermissionsService` merge step
   * collapses any wildcard to `'all'` in the EffectiveAccess payload.
   * Guards/helpers return the string `'all'` so callers can skip filtering.
   */
  allow_all?: boolean;
}

/**
 * Sentinel JSONB shape for an attribute that has been wildcarded — see
 * `AttributeSchemaItem.allow_all`. Stored verbatim on
 * `role_assignment_attributes.value`; the server side knows to interpret it
 * and emit `'all'` in the EffectiveAccess shape.
 */
export interface WildcardAllValue {
  all: true;
}

export const WILDCARD_ALL: WildcardAllValue = { all: true };

/** Type-guard for the wildcard sentinel — never matches plain ids/arrays. */
export function isWildcardAll(value: unknown): value is WildcardAllValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { all?: unknown }).all === true
  );
}

export interface ScreenDef {
  /** Globally unique identifier, dot-separated, e.g. "academics.timetable.manage". */
  key: string;
  /** FK into ModuleDef.key. */
  module_key: string;
  /** Which role types this screen may be included under in a composed role. */
  role_type_keys: string[];
  /** Where this screen renders. */
  platforms: Platform[];
  /** Human label shown in menus. */
  label: string;
  description?: string;
  /** Route in the nucleus-ui employee portal — undefined when no web screen. */
  web_route?: string;
  /** Route in the nucleus-mobile app — undefined when no mobile screen. */
  mobile_route?: string;
  /** Action keys gated per assignment, e.g. ["view","create","edit","delete"]. */
  actions: string[];
  /** Per-assignment data the screen needs to scope its queries. */
  attributes: AttributeSchemaItem[];
}

export interface Catalog {
  modules: ReadonlyArray<ModuleDef>;
  role_types: ReadonlyArray<RoleTypeDef>;
  attribute_types: ReadonlyArray<AttributeTypeDef>;
  screens: ReadonlyArray<ScreenDef>;
}
