import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { In, Repository } from 'typeorm';
import { REDIS_CLIENT } from '../redis/redis.module';
import { isWildcardAll } from './catalog';
import { CatalogService } from './catalog.service';
import { RoleAssignmentAttribute } from './entities/role-assignment-attribute.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { RoleScreen } from './entities/role-screen.entity';
import { Role } from './entities/role.entity';

/**
 * Per-attribute scope the employee has on a given screen.
 *
 *   { all: true }                      → wildcard, no filter
 *   { all: false, values: [1, 2] }     → restricted to these ids
 *   { all: false, values: [] }         → unset (no access for required scope)
 *
 * The `all: true` branch is the merged result of any contributing assignment
 * setting `{ all: true }` on this attribute. Otherwise values are the union
 * across contributing assignments.
 */
export type AttributeAccess =
  | { all: true }
  | { all: false; values: unknown[] };

/**
 * The full effective-access map for an employee, returned by
 * `GET /employee/me/access` and used by guards/helpers to gate every
 * server-side action.
 *
 * Static fields (`label`, `icon`, `order`, `module_key`, `platforms`,
 * `web_route`, `mobile_route`) are re-derived from the live catalog on every
 * read — only the volatile bits (`actions`, `attributes`) are cached. That
 * means edits to `modules.ts` / `screens.ts` show up immediately for every
 * employee on the next request, without waiting for the Redis TTL.
 */
export interface EffectiveAccess {
  employee_id: number;
  modules: Record<
    string,
    {
      key: string;
      label: string;
      icon: string;
      order: number;
      screen_keys: string[];
    }
  >;
  screens: Record<
    string,
    {
      key: string;
      module_key: string;
      label: string;
      platforms: string[];
      web_route?: string;
      mobile_route?: string;
      actions: string[]; // union of allowed_actions across assignments
      attributes: Record<string, AttributeAccess>; // merged, wildcard-aware
    }
  >;
}

/**
 * The minimal shape that goes into Redis. Per-employee data ONLY — nothing
 * the catalog can change should live in here.
 */
interface CachedAccess {
  employee_id: number;
  screens: Record<
    string,
    {
      actions: string[];
      attributes: Record<string, AttributeAccess>;
      // Union across the employee's assignments of which platforms each
      // contributing role granted for this screen. Hydrate intersects this
      // with the live catalog before emitting EffectiveAccess.
      platforms: string[];
    }
  >;
}

/**
 * Sentinel returned by the `getAccessibleXIds` helpers when the employee has
 * a wildcard scope for that attribute on that screen. Callers MUST treat this
 * as "no filter" — do NOT pass an empty array to your `IN (...)` clause, that
 * would mean "no access". See the RBAC enforcement contract in CLAUDE.md.
 */
export const ACCESS_ALL = 'all' as const;
export type AccessibleIds = number[] | typeof ACCESS_ALL;

const CACHE_TTL_SECONDS = 5 * 60;

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(RoleScreen)
    private readonly roleScreens: Repository<RoleScreen>,
    @InjectRepository(RoleAssignment)
    private readonly assignments: Repository<RoleAssignment>,
    @InjectRepository(RoleAssignmentAttribute)
    private readonly assignmentAttributes: Repository<RoleAssignmentAttribute>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly catalog: CatalogService,
  ) {}

  // ---------------------------------------------------------------------------
  // Effective access
  // ---------------------------------------------------------------------------

  async getEffectiveAccess(employeeId: number): Promise<EffectiveAccess> {
    const cacheKey = this.cacheKey(employeeId);
    let cached: CachedAccess | null = null;

    const raw = await this.redis.get(cacheKey);
    if (raw) {
      try {
        cached = JSON.parse(raw) as CachedAccess;
      } catch {
        // Corrupt cache entry — fall through and rebuild.
      }
    }

    if (!cached) {
      cached = await this.computeCachedAccess(employeeId);
      try {
        await this.redis.set(
          cacheKey,
          JSON.stringify(cached),
          'EX',
          CACHE_TTL_SECONDS,
        );
      } catch (err) {
        this.logger.warn(
          `Could not cache permissions for employee ${employeeId}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }

    return this.hydrate(cached);
  }

  /**
   * Re-attach live catalog data (labels, icons, orders, routes, platforms,
   * module groupings) to the lean cached blob. Anything from the catalog must
   * be read FRESH here so catalog edits take effect on the next request, not
   * on the next cache eviction.
   */
  private hydrate(cached: CachedAccess): EffectiveAccess {
    const screens: EffectiveAccess['screens'] = {};
    const modules: EffectiveAccess['modules'] = {};

    for (const [screenKey, slot] of Object.entries(cached.screens)) {
      const def = this.catalog.getScreen(screenKey);
      if (!def) {
        // Catalog drift — the screen no longer exists. Skip rather than 500.
        continue;
      }

      // Filter cached actions against the current catalog declaration so a
      // since-removed action doesn't leak through.
      const liveActions = slot.actions.filter((a) => def.actions.includes(a));

      // Effective platforms = catalog platforms ∩ role grants. If the catalog
      // dropped a platform, the role's grant for that platform is ignored.
      // If the role didn't grant any platform that's still on the catalog,
      // the screen is fully suppressed from this employee's menu.
      const cachedPlatforms = slot.platforms ?? [...def.platforms];
      const livePlatforms = cachedPlatforms.filter((p) =>
        def.platforms.includes(p as (typeof def.platforms)[number]),
      );
      if (livePlatforms.length === 0) {
        // No reachable platform — drop the screen entirely so the consumer
        // doesn't render a menu entry that can't open anywhere.
        continue;
      }

      screens[screenKey] = {
        key: def.key,
        module_key: def.module_key,
        label: def.label,
        platforms: livePlatforms,
        web_route: livePlatforms.includes('web') ? def.web_route : undefined,
        mobile_route: livePlatforms.includes('mobile')
          ? def.mobile_route
          : undefined,
        actions: liveActions,
        attributes: slot.attributes,
      };

      const moduleDef = this.catalog.getModule(def.module_key);
      if (!moduleDef) continue;
      const modSlot =
        modules[moduleDef.key] ??
        ({
          key: moduleDef.key,
          label: moduleDef.label,
          icon: moduleDef.icon,
          order: moduleDef.order,
          screen_keys: [],
        } as EffectiveAccess['modules'][string]);
      if (!modSlot.screen_keys.includes(screenKey)) {
        modSlot.screen_keys.push(screenKey);
      }
      modules[moduleDef.key] = modSlot;
    }

    this.deriveStudentMarksView(screens, modules);

    return { employee_id: cached.employee_id, modules, screens };
  }

  /**
   * Derive the read-only `examinations.marks.view` ("Student marks") screen
   * from the `examinations.marks.upload` grant. Product decision: anyone who
   * can upload a batch's marks may also view them, with no separate RBAC
   * assignment — so we synthesise the view screen here, copying the upload
   * screen's `programme_admission_year_ids` scope verbatim. This makes the
   * screen show in nav, pass the ScreenAccessGuard, and resolve the same
   * batch scope via getAccessibleProgrammeAdmissionYearIds(..., VIEW_KEY).
   *
   * If the view screen was assigned independently (e.g. a read-only reviewer
   * who cannot upload), that real grant is already in `screens` and we leave
   * it untouched — the explicit assignment wins.
   */
  private deriveStudentMarksView(
    screens: EffectiveAccess['screens'],
    modules: EffectiveAccess['modules'],
  ): void {
    const UPLOAD_KEY = 'examinations.marks.upload';
    const VIEW_KEY = 'examinations.marks.view';

    const uploadSlot = screens[UPLOAD_KEY];
    if (!uploadSlot || screens[VIEW_KEY]) return;
    // The view screen is web-only; only derive it where upload is reachable on web.
    if (!uploadSlot.platforms.includes('web')) return;

    const viewDef = this.catalog.getScreen(VIEW_KEY);
    if (!viewDef) return;

    screens[VIEW_KEY] = {
      key: viewDef.key,
      module_key: viewDef.module_key,
      label: viewDef.label,
      platforms: ['web'],
      web_route: viewDef.web_route,
      mobile_route: undefined,
      actions: ['view'],
      attributes: uploadSlot.attributes,
    };

    const moduleDef = this.catalog.getModule(viewDef.module_key);
    if (!moduleDef) return;
    const modSlot =
      modules[moduleDef.key] ??
      ({
        key: moduleDef.key,
        label: moduleDef.label,
        icon: moduleDef.icon,
        order: moduleDef.order,
        screen_keys: [],
      } as EffectiveAccess['modules'][string]);
    if (!modSlot.screen_keys.includes(VIEW_KEY)) {
      modSlot.screen_keys.push(VIEW_KEY);
    }
    modules[moduleDef.key] = modSlot;
  }

  /**
   * Build the lean per-employee cache shape from the database. Static catalog
   * fields ({@link hydrate} re-attaches them) are deliberately NOT included so
   * catalog edits don't require cache invalidation.
   */
  private async computeCachedAccess(
    employeeId: number,
  ): Promise<CachedAccess> {
    // An employee holds at most one assignment (unique on employee_id), but
    // the rest of this function works with a list to keep the union logic
    // straightforward — assignment revoke is a hard delete, so any row found
    // here is by definition live.
    const activeAssignments = await this.assignments.find({
      where: { employee_id: employeeId },
    });

    if (activeAssignments.length === 0) {
      return { employee_id: employeeId, screens: {} };
    }

    const assignmentIds = activeAssignments.map((a) => a.id);
    const roleIds = Array.from(new Set(activeAssignments.map((a) => a.role_id)));

    const [activeRoles, screenRows, attrRows] = await Promise.all([
      this.roles.find({ where: { id: In(roleIds), is_active: true } }),
      this.roleScreens.find({ where: { role_id: In(roleIds) } }),
      this.assignmentAttributes.find({
        where: { role_assignment_id: In(assignmentIds) },
      }),
    ]);

    const activeRoleIds = new Set(activeRoles.map((r) => r.id));
    const liveAssignments = activeAssignments.filter((a) =>
      activeRoleIds.has(a.role_id),
    );
    const liveAssignmentIds = new Set(liveAssignments.map((a) => a.id));
    const liveRoleIds = new Set(liveAssignments.map((a) => a.role_id));

    // role_id → role_screens within live roles
    const screensByRole = new Map<number, RoleScreen[]>();
    for (const rs of screenRows) {
      if (!liveRoleIds.has(rs.role_id)) continue;
      const list = screensByRole.get(rs.role_id) ?? [];
      list.push(rs);
      screensByRole.set(rs.role_id, list);
    }

    // assignment_id → attributes within live assignments
    const attrsByAssignment = new Map<number, RoleAssignmentAttribute[]>();
    for (const a of attrRows) {
      if (!liveAssignmentIds.has(a.role_assignment_id)) continue;
      const list = attrsByAssignment.get(a.role_assignment_id) ?? [];
      list.push(a);
      attrsByAssignment.set(a.role_assignment_id, list);
    }

    const screens: CachedAccess['screens'] = {};

    for (const assignment of liveAssignments) {
      const roleScreens = screensByRole.get(assignment.role_id) ?? [];
      const assignmentAttrs = attrsByAssignment.get(assignment.id) ?? [];

      // Group this assignment's attribute rows by screen_key for fast lookup.
      const attrsByScreen = new Map<string, RoleAssignmentAttribute[]>();
      for (const a of assignmentAttrs) {
        const list = attrsByScreen.get(a.screen_key) ?? [];
        list.push(a);
        attrsByScreen.set(a.screen_key, list);
      }

      for (const rs of roleScreens) {
        const def = this.catalog.getScreen(rs.screen_key);
        if (!def) {
          // Catalog drift — role references a screen that no longer exists.
          // Skip silently; the catalog validator catches this at boot for
          // new code, and revoked screens shouldn't 500 a logged-in user.
          continue;
        }

        const slot = screens[rs.screen_key] ?? {
          actions: [],
          attributes: {},
          platforms: [],
        };

        // Union actions (only those declared on the screen def — catalog wins).
        for (const action of rs.allowed_actions) {
          if (def.actions.includes(action) && !slot.actions.includes(action)) {
            slot.actions.push(action);
          }
        }

        // Union platforms (only those declared on the screen def — catalog
        // wins). Older rows without an allowed_platforms value default to the
        // catalog set so the migration backfill is honoured on legacy data.
        const grantedPlatforms =
          rs.allowed_platforms && rs.allowed_platforms.length > 0
            ? rs.allowed_platforms
            : [...def.platforms];
        for (const p of grantedPlatforms) {
          if (
            def.platforms.includes(p as (typeof def.platforms)[number]) &&
            !slot.platforms.includes(p)
          ) {
            slot.platforms.push(p);
          }
        }

        // Merge attribute values for this screen from this assignment.
        const attrsForScreen = attrsByScreen.get(rs.screen_key) ?? [];
        for (const attr of attrsForScreen) {
          const attrDef = def.attributes.find((a) => a.key === attr.attribute_key);
          if (!attrDef) continue; // catalog drift on attributes — ignore

          const existing: AttributeAccess = slot.attributes[
            attr.attribute_key
          ] ?? { all: false, values: [] };

          // Wildcard wins forever — once any contributor says "all", the
          // merged scope is "all" and stays "all" regardless of any
          // subsequent specific-id contributions.
          if (existing.all === true) {
            slot.attributes[attr.attribute_key] = existing;
            continue;
          }

          if (isWildcardAll(attr.value)) {
            // Only honour wildcard if the catalog allows it on this attribute.
            // Stale wildcards (set when allow_all was true, then turned off)
            // are downgraded to no contribution rather than crashing.
            if (attrDef.allow_all) {
              slot.attributes[attr.attribute_key] = { all: true };
            }
            continue;
          }

          const incoming = attrDef.multi
            ? Array.isArray(attr.value)
              ? attr.value
              : []
            : [attr.value];

          for (const v of incoming) {
            if (v === null || v === undefined) continue;
            if (!existing.values.some((e) => deepEqual(e, v))) {
              existing.values.push(v);
            }
          }
          slot.attributes[attr.attribute_key] = existing;
        }

        screens[rs.screen_key] = slot;
      }
    }

    return { employee_id: employeeId, screens };
  }

  // ---------------------------------------------------------------------------
  // Cache invalidation
  // ---------------------------------------------------------------------------

  async invalidate(employeeId: number): Promise<void> {
    await this.redis.del(this.cacheKey(employeeId));
  }

  /** Invalidate cache for every employee assigned to the given role. */
  async invalidateRole(roleId: number): Promise<void> {
    const assignees = await this.assignments.find({
      where: { role_id: roleId },
      select: { employee_id: true },
    });
    if (assignees.length === 0) return;
    const keys = Array.from(new Set(assignees.map((a) => a.employee_id))).map(
      (id) => this.cacheKey(id),
    );
    await this.redis.del(...keys);
  }

  // ---------------------------------------------------------------------------
  // Helpers used by guards and controllers
  // ---------------------------------------------------------------------------

  async hasScreen(employeeId: number, screenKey: string): Promise<boolean> {
    const access = await this.getEffectiveAccess(employeeId);
    return !!access.screens[screenKey];
  }

  async hasAction(
    employeeId: number,
    screenKey: string,
    action: string,
  ): Promise<boolean> {
    const access = await this.getEffectiveAccess(employeeId);
    const slot = access.screens[screenKey];
    if (!slot) return false;
    return slot.actions.includes(action);
  }

  /**
   * Raw attribute access for an employee on a screen. Returns:
   *   { all: true }                  → wildcard, caller should skip filtering
   *   { all: false, values: [...] }  → specific values (possibly empty)
   *   { all: false, values: [] }     → unset (treat as no access for required scope)
   */
  async getAttribute(
    employeeId: number,
    screenKey: string,
    attributeKey: string,
  ): Promise<AttributeAccess> {
    const access = await this.getEffectiveAccess(employeeId);
    const slot = access.screens[screenKey];
    if (!slot) return { all: false, values: [] };
    return slot.attributes[attributeKey] ?? { all: false, values: [] };
  }

  /**
   * Numeric-id helper. Returns the sentinel `'all'` when the employee has the
   * wildcard scope (caller skips filtering), otherwise an array of ids that
   * the caller must use as a hard `IN (...)` filter. **An empty array means
   * NO ACCESS** — return an empty result; never fall back to "all rows".
   */
  private async getAttributeNumericIds(
    employeeId: number,
    screenKey: string,
    attributeKey: string,
  ): Promise<AccessibleIds> {
    const access = await this.getAttribute(employeeId, screenKey, attributeKey);
    if (access.all) return ACCESS_ALL;
    return access.values
      .map((v) => (typeof v === 'number' ? v : Number(v)))
      .filter((v) => Number.isFinite(v));
  }

  getAccessibleDepartmentIds(
    employeeId: number,
    screenKey: string,
  ): Promise<AccessibleIds> {
    return this.getAttributeNumericIds(employeeId, screenKey, 'department_id');
  }

  getAccessibleProgrammeIds(
    employeeId: number,
    screenKey: string,
  ): Promise<AccessibleIds> {
    return this.getAttributeNumericIds(employeeId, screenKey, 'programme_ids');
  }

  getAccessibleAdmissionYearIds(
    employeeId: number,
    screenKey: string,
  ): Promise<AccessibleIds> {
    return this.getAttributeNumericIds(
      employeeId,
      screenKey,
      'admission_year_ids',
    );
  }

  getAccessibleSemesterIds(
    employeeId: number,
    screenKey: string,
  ): Promise<AccessibleIds> {
    return this.getAttributeNumericIds(employeeId, screenKey, 'semester_ids');
  }

  getAccessibleRegulationIds(
    employeeId: number,
    screenKey: string,
  ): Promise<AccessibleIds> {
    return this.getAttributeNumericIds(
      employeeId,
      screenKey,
      'regulation_ids',
    );
  }

  getAccessibleAttendanceGroupIds(
    employeeId: number,
    screenKey: string,
  ): Promise<AccessibleIds> {
    return this.getAttributeNumericIds(
      employeeId,
      screenKey,
      'attendance_group_ids',
    );
  }

  getAccessibleProgrammeAdmissionYearIds(
    employeeId: number,
    screenKey: string,
  ): Promise<AccessibleIds> {
    return this.getAttributeNumericIds(
      employeeId,
      screenKey,
      'programme_admission_year_ids',
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private cacheKey(employeeId: number): string {
    return `rbac:perm:emp:${employeeId}`;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
