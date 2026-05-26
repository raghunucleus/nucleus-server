import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import {
  ATTRIBUTE_FETCHERS,
  isWildcardAll,
  type PickerOption,
} from '../catalog';
import { CatalogService } from '../catalog.service';
import { RoleAssignmentAttribute } from '../entities/role-assignment-attribute.entity';
import { RoleAssignment } from '../entities/role-assignment.entity';
import { RoleScreen } from '../entities/role-screen.entity';
import { Role } from '../entities/role.entity';
import { PermissionsService } from '../permissions.service';

export interface RoleDetail {
  id: number;
  code: string;
  name: string;
  description: string | null;
  role_type_keys: string[];
  is_active: boolean;
  // Number of currently-active assignments referencing this role. The admin
  // UI uses this to disable the deactivate action up front; the server is the
  // source of truth and refuses deactivation if this is > 0.
  active_assignment_count: number;
  screens: {
    screen_key: string;
    allowed_actions: string[];
    allowed_platforms: string[];
  }[];
  created_at: Date;
  updated_at: Date;
}

export interface AssignmentDetail {
  id: number;
  role_id: number;
  role_code: string;
  role_name: string;
  employee_id: number;
  employee_emp_code: string;
  employee_display_name: string;
  attributes: {
    screen_key: string;
    attribute_key: string;
    value: unknown;
  }[];
  created_at: Date;
  updated_at: Date;
}

export interface ListRolesResult {
  rows: RoleDetail[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ListAssignmentsResult {
  rows: AssignmentDetail[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

interface CreateRoleInput {
  code: string;
  name: string;
  description: string | null | undefined;
  role_type_keys: string[];
  screens: {
    screen_key: string;
    allowed_actions: string[];
    allowed_platforms: string[];
  }[];
}

interface UpdateRoleInput {
  code?: string;
  name?: string;
  description?: string | null;
  role_type_keys?: string[];
  screens?: {
    screen_key: string;
    allowed_actions: string[];
    allowed_platforms: string[];
  }[];
}

interface CreateAssignmentInput {
  role_id: number;
  employee_id: number;
  attributes: {
    screen_key: string;
    attribute_key: string;
    value: unknown;
  }[];
  assigned_by_admin_id: number | null;
}

interface UpdateAssignmentInput {
  attributes?: {
    screen_key: string;
    attribute_key: string;
    value: unknown;
  }[];
}

@Injectable()
export class RbacAdminService {
  private readonly logger = new Logger(RbacAdminService.name);

  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(RoleScreen)
    private readonly roleScreens: Repository<RoleScreen>,
    @InjectRepository(RoleAssignment)
    private readonly assignments: Repository<RoleAssignment>,
    @InjectRepository(RoleAssignmentAttribute)
    private readonly assignmentAttributes: Repository<RoleAssignmentAttribute>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly catalog: CatalogService,
    private readonly permissions: PermissionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Attribute pickers — proxies through to the static fetcher registry
  // ---------------------------------------------------------------------------

  /**
   * Run the registered fetcher for a catalog attribute type and return its
   * `{ id, label }` options.
   *
   * Error policy: fetcher failures are SURFACED (not swallowed). Returning
   * `[]` on a real failure would let an admin save a role assignment with
   * silently-unscoped or empty values they didn't intend — the UI would
   * look "valid" while the underlying data layer is broken. The admin-ui
   * already toasts "Couldn't load <label> options" and renders an explicit
   * empty Combobox via its sentinel pattern; the server-side log here is
   * the operator's signal to fix the root cause.
   *
   * Per-ROW failure inside a fetcher is a different concern — fetchers
   * should be defensive about nullable joins (`?? '—'`) so one corrupt
   * row doesn't kill the whole picker. See the comment in
   * attribute-fetchers.ts.
   */
  async getAttributeOptions(typeKey: string): Promise<PickerOption[]> {
    if (!this.catalog.getAttributeType(typeKey)) {
      throw new NotFoundException(`Unknown attribute type "${typeKey}"`);
    }
    const fetcher = ATTRIBUTE_FETCHERS[typeKey];
    if (!fetcher) {
      // Shouldn't happen given the validator; defensive in case the catalog
      // and registry are edited out-of-sync mid-deploy.
      throw new NotFoundException(
        `No fetcher registered for attribute type "${typeKey}"`,
      );
    }
    try {
      return await fetcher(this.dataSource);
    } catch (err) {
      // Log with the type key so it's grep-able when an admin reports a
      // broken picker — then rethrow so the controller emits 500 and the
      // UI toast surfaces it.
      this.logger.error(
        `Fetcher for attribute type "${typeKey}" failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------

  async listRoles(opts: {
    page: number;
    pageSize: number;
    name?: string;
    status?: 'active' | 'inactive';
    sortBy?:
      | 'code'
      | 'name'
      | 'is_active'
      | 'created_at'
      | 'updated_at';
    sortOrder?: 'asc' | 'desc';
  }): Promise<ListRolesResult> {
    const qb = this.roles.createQueryBuilder('r');
    if (opts.name) {
      // Search both name and code so the admin can type either to find a role.
      qb.andWhere('(LOWER(r.name) LIKE :n OR LOWER(r.code) LIKE :n)', {
        n: `%${opts.name.toLowerCase()}%`,
      });
    }
    if (opts.status === 'active') qb.andWhere('r.is_active = TRUE');
    if (opts.status === 'inactive') qb.andWhere('r.is_active = FALSE');

    // sortBy / sortOrder are validated by the Zod DTO, but they're optional on
    // the service contract (other callers may not pass them). Fall back to a
    // stable name-asc default.
    const sortBy = opts.sortBy ?? 'name';
    const order: 'ASC' | 'DESC' = opts.sortOrder === 'desc' ? 'DESC' : 'ASC';
    qb.orderBy(`r.${sortBy}`, order);
    // Tie-break on id so a deactivated/reactivated role doesn't shuffle
    // between pages when the primary sort is on a non-unique column.
    if (sortBy !== 'name') qb.addOrderBy('r.id', 'ASC');

    qb.skip((opts.page - 1) * opts.pageSize).take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();
    const roleIds = rows.map((r) => r.id);

    const screens = roleIds.length
      ? await this.roleScreens.find({ where: { role_id: In(roleIds) } })
      : [];
    const screensByRole = new Map<number, RoleScreen[]>();
    for (const s of screens) {
      const list = screensByRole.get(s.role_id) ?? [];
      list.push(s);
      screensByRole.set(s.role_id, list);
    }

    const countsByRole = await this.countActiveAssignmentsByRole(roleIds);
    return {
      rows: rows.map((r) =>
        this.toRoleDetail(
          r,
          screensByRole.get(r.id) ?? [],
          countsByRole.get(r.id) ?? 0,
        ),
      ),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
    };
  }

  async getRole(id: number): Promise<RoleDetail> {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    const screens = await this.roleScreens.find({ where: { role_id: id } });
    const count = await this.countActiveAssignments(id);
    return this.toRoleDetail(role, screens, count);
  }

  async createRole(input: CreateRoleInput): Promise<RoleDetail> {
    this.validateRoleTypeKeys(input.role_type_keys);
    this.validateScreens(input.screens, input.role_type_keys);

    // Case-insensitive checks: a Postgres UNIQUE on `code`/`name` is
    // case-SENSITIVE, so a separate query is what enforces "CSE_HOD" and
    // "cse_hod" can't both exist.
    const nameDupe = await this.roles
      .createQueryBuilder('r')
      .where('LOWER(r.name) = LOWER(:n)', { n: input.name })
      .getOne();
    if (nameDupe) throw new BadRequestException('Role name is already in use');

    const codeDupe = await this.roles
      .createQueryBuilder('r')
      .where('LOWER(r.code) = LOWER(:c)', { c: input.code })
      .getOne();
    if (codeDupe) throw new BadRequestException('Role code is already in use');

    return this.dataSource.transaction(async (manager) => {
      const roleRepo = manager.getRepository(Role);
      const screenRepo = manager.getRepository(RoleScreen);

      const role = await roleRepo.save(
        roleRepo.create({
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          role_type_keys: input.role_type_keys,
          is_active: true,
        }),
      );

      for (const s of input.screens) {
        await screenRepo.save(
          screenRepo.create({
            role_id: role.id,
            screen_key: s.screen_key,
            allowed_actions: s.allowed_actions,
            allowed_platforms: s.allowed_platforms,
          }),
        );
      }

      const screens = await screenRepo.find({ where: { role_id: role.id } });
      // Freshly created role has no assignments yet.
      return this.toRoleDetail(role, screens, 0);
    });
  }

  async updateRole(id: number, patch: UpdateRoleInput): Promise<RoleDetail> {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    if (patch.name !== undefined && patch.name !== role.name) {
      const dupe = await this.roles
        .createQueryBuilder('r')
        .where('LOWER(r.name) = LOWER(:n) AND r.id != :id', {
          n: patch.name,
          id,
        })
        .getOne();
      if (dupe) throw new BadRequestException('Role name is already in use');
    }

    if (patch.code !== undefined && patch.code !== role.code) {
      const dupe = await this.roles
        .createQueryBuilder('r')
        .where('LOWER(r.code) = LOWER(:c) AND r.id != :id', {
          c: patch.code,
          id,
        })
        .getOne();
      if (dupe) throw new BadRequestException('Role code is already in use');
    }

    const nextRoleTypes = patch.role_type_keys ?? role.role_type_keys;
    if (patch.role_type_keys !== undefined) {
      this.validateRoleTypeKeys(nextRoleTypes);
    }
    if (patch.screens !== undefined) {
      this.validateScreens(patch.screens, nextRoleTypes);
    }

    return this.dataSource.transaction(async (manager) => {
      const roleRepo = manager.getRepository(Role);
      const screenRepo = manager.getRepository(RoleScreen);

      if (patch.code !== undefined) role.code = patch.code;
      if (patch.name !== undefined) role.name = patch.name;
      if (patch.description !== undefined) role.description = patch.description;
      if (patch.role_type_keys !== undefined) {
        role.role_type_keys = patch.role_type_keys;
      }
      await roleRepo.save(role);

      if (patch.screens !== undefined) {
        await screenRepo.delete({ role_id: id });
        for (const s of patch.screens) {
          await screenRepo.save(
            screenRepo.create({
              role_id: id,
              screen_key: s.screen_key,
              allowed_actions: s.allowed_actions,
              allowed_platforms: s.allowed_platforms,
            }),
          );
        }
      }

      const screens = await screenRepo.find({ where: { role_id: id } });
      await this.permissions.invalidateRole(id);
      const count = await this.countActiveAssignments(id);
      return this.toRoleDetail(role, screens, count);
    });
  }

  async setRoleActive(id: number, active: boolean): Promise<RoleDetail> {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');

    // Deactivating a role with live assignments would silently revoke access
    // for every assigned employee — make the admin revoke the assignments
    // explicitly first so the chain of intent is visible.
    if (!active && role.is_active) {
      const liveCount = await this.countActiveAssignments(id);
      if (liveCount > 0) {
        throw new BadRequestException(
          `Cannot deactivate "${role.name}" — ${liveCount} active assignment${
            liveCount === 1 ? ' uses' : 's use'
          } this role. Revoke the assignment${
            liveCount === 1 ? '' : 's'
          } first.`,
        );
      }
    }

    if (role.is_active === active) {
      const screens = await this.roleScreens.find({ where: { role_id: id } });
      const count = await this.countActiveAssignments(id);
      return this.toRoleDetail(role, screens, count);
    }
    role.is_active = active;
    await this.roles.save(role);
    await this.permissions.invalidateRole(id);
    const screens = await this.roleScreens.find({ where: { role_id: id } });
    const count = await this.countActiveAssignments(id);
    return this.toRoleDetail(role, screens, count);
  }

  // ---------------------------------------------------------------------------
  // Assignments
  // ---------------------------------------------------------------------------

  async listAssignments(opts: {
    employee_id?: number;
    role_id?: number;
    q?: string;
    page: number;
    pageSize: number;
    sortBy?: 'employee' | 'role' | 'created_at' | 'updated_at';
    sortOrder?: 'asc' | 'desc';
  }): Promise<ListAssignmentsResult> {
    const qb = this.assignments
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.role', 'role')
      .leftJoinAndSelect('a.employee', 'employee');

    if (opts.employee_id) {
      qb.andWhere('a.employee_id = :eid', { eid: opts.employee_id });
    }
    if (opts.role_id) {
      qb.andWhere('a.role_id = :rid', { rid: opts.role_id });
    }

    if (opts.q) {
      const needle = `%${opts.q.toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(employee.emp_display_name) LIKE :q' +
          ' OR LOWER(employee.emp_code) LIKE :q' +
          ' OR LOWER(role.name) LIKE :q' +
          ' OR LOWER(role.code) LIKE :q)',
        { q: needle },
      );
    }

    // Map the public sort field onto the joined column it actually represents.
    const sortBy = opts.sortBy ?? 'created_at';
    const order: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const sortColumn =
      sortBy === 'employee'
        ? 'employee.emp_display_name'
        : sortBy === 'role'
          ? 'role.name'
          : `a.${sortBy}`;
    qb.orderBy(sortColumn, order);
    // Tiebreak on id so rows don't shuffle across pages when the primary
    // sort column has duplicates (e.g. two assignments updated in the same
    // batch).
    qb.addOrderBy('a.id', 'ASC');

    qb.skip((opts.page - 1) * opts.pageSize).take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();

    const assignmentIds = rows.map((r) => r.id);
    const attrRows = assignmentIds.length
      ? await this.assignmentAttributes.find({
          where: { role_assignment_id: In(assignmentIds) },
        })
      : [];
    const attrsByAssignment = new Map<number, RoleAssignmentAttribute[]>();
    for (const a of attrRows) {
      const list = attrsByAssignment.get(a.role_assignment_id) ?? [];
      list.push(a);
      attrsByAssignment.set(a.role_assignment_id, list);
    }

    return {
      rows: rows.map((a) =>
        this.toAssignmentDetail(a, attrsByAssignment.get(a.id) ?? []),
      ),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
    };
  }

  async getAssignment(id: number): Promise<AssignmentDetail> {
    const assignment = await this.assignments.findOne({
      where: { id },
      relations: { role: true, employee: true },
    });
    if (!assignment) throw new NotFoundException('Assignment not found');
    const attrs = await this.assignmentAttributes.find({
      where: { role_assignment_id: id },
    });
    return this.toAssignmentDetail(assignment, attrs);
  }

  async createAssignment(
    input: CreateAssignmentInput,
  ): Promise<AssignmentDetail> {
    const role = await this.roles.findOne({ where: { id: input.role_id } });
    if (!role) throw new BadRequestException('Role not found');
    if (!role.is_active) {
      throw new BadRequestException('Role is inactive');
    }

    const employee = await this.employees.findOne({
      where: { id: input.employee_id },
    });
    if (!employee) throw new BadRequestException('Employee not found');
    if (!employee.is_active) {
      throw new BadRequestException('Employee is inactive');
    }

    const roleScreens = await this.roleScreens.find({
      where: { role_id: input.role_id },
    });
    this.validateAttributesAgainstRole(input.attributes, roleScreens);

    // One assignment per employee — if the employee already holds one, drop
    // it (and its attributes via the cascade FK) before inserting the new row.
    // This makes "assign role" idempotent from the admin's POV: hand an
    // employee a role and the latest call always wins.
    //
    // We re-query inside the transaction to avoid a TOCTOU race where two
    // admins assign roles to the same employee concurrently; the unique
    // constraint on employee_id is the ultimate guard.
    const newAssignmentId = await this.dataSource.transaction(
      async (manager) => {
        const assignmentRepo = manager.getRepository(RoleAssignment);
        const attrRepo = manager.getRepository(RoleAssignmentAttribute);

        await assignmentRepo.delete({ employee_id: input.employee_id });

        const assignment = await assignmentRepo.save(
          assignmentRepo.create({
            role_id: input.role_id,
            employee_id: input.employee_id,
            assigned_by_admin_id: input.assigned_by_admin_id,
          }),
        );

        for (const a of input.attributes) {
          await attrRepo.save(
            attrRepo.create({
              role_assignment_id: assignment.id,
              screen_key: a.screen_key,
              attribute_key: a.attribute_key,
              value: a.value,
            }),
          );
        }

        return assignment.id;
      },
    );

    await this.permissions.invalidate(input.employee_id);
    return this.getAssignment(newAssignmentId);
  }

  async updateAssignment(
    id: number,
    patch: UpdateAssignmentInput,
  ): Promise<AssignmentDetail> {
    const assignment = await this.assignments.findOne({ where: { id } });
    if (!assignment) throw new NotFoundException('Assignment not found');

    if (patch.attributes !== undefined) {
      const roleScreens = await this.roleScreens.find({
        where: { role_id: assignment.role_id },
      });
      this.validateAttributesAgainstRole(patch.attributes, roleScreens);
    }

    // Same reason as createAssignment: don't call getAssignment inside the
    // transaction (it queries via the service-level repo, not the manager).
    await this.dataSource.transaction(async (manager) => {
      const attrRepo = manager.getRepository(RoleAssignmentAttribute);

      if (patch.attributes !== undefined) {
        await attrRepo.delete({ role_assignment_id: id });
        for (const a of patch.attributes) {
          await attrRepo.save(
            attrRepo.create({
              role_assignment_id: id,
              screen_key: a.screen_key,
              attribute_key: a.attribute_key,
              value: a.value,
            }),
          );
        }
      }
    });

    await this.permissions.invalidate(assignment.employee_id);
    return this.getAssignment(id);
  }

  async revokeAssignment(id: number): Promise<void> {
    const assignment = await this.assignments.findOne({ where: { id } });
    if (!assignment) throw new NotFoundException('Assignment not found');
    // Hard delete — the attributes cascade. After this, the employee has no
    // role; their effective permissions become empty on the next compute.
    const employeeId = assignment.employee_id;
    await this.assignments.delete(id);
    await this.permissions.invalidate(employeeId);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  private validateRoleTypeKeys(keys: string[]): void {
    const dupes = new Set<string>();
    for (const k of keys) {
      if (dupes.has(k)) {
        throw new BadRequestException(`Duplicate role type "${k}"`);
      }
      dupes.add(k);
      if (!this.catalog.getRoleType(k)) {
        throw new BadRequestException(`Unknown role type "${k}"`);
      }
    }
  }

  private validateScreens(
    screens: {
      screen_key: string;
      allowed_actions: string[];
      allowed_platforms: string[];
    }[],
    roleTypeKeys: string[],
  ): void {
    const allowedRoleTypes = new Set(roleTypeKeys);
    const seenKeys = new Set<string>();
    for (const s of screens) {
      if (seenKeys.has(s.screen_key)) {
        throw new BadRequestException(
          `Duplicate screen "${s.screen_key}" in role`,
        );
      }
      seenKeys.add(s.screen_key);

      const def = this.catalog.getScreen(s.screen_key);
      if (!def) {
        throw new BadRequestException(`Unknown screen "${s.screen_key}"`);
      }

      const intersects = def.role_type_keys.some((rt) =>
        allowedRoleTypes.has(rt),
      );
      if (!intersects) {
        throw new BadRequestException(
          `Screen "${s.screen_key}" is not available for the selected role types`,
        );
      }

      const seenActions = new Set<string>();
      for (const action of s.allowed_actions) {
        if (seenActions.has(action)) {
          throw new BadRequestException(
            `Duplicate action "${action}" on screen "${s.screen_key}"`,
          );
        }
        seenActions.add(action);
        if (!def.actions.includes(action)) {
          throw new BadRequestException(
            `Action "${action}" is not declared on screen "${s.screen_key}"`,
          );
        }
      }

      // Platforms: every requested platform must be declared on the catalog
      // screen. Empty arrays are already blocked by the DTO, but assert here
      // too so a direct service call doesn't bypass it.
      if (s.allowed_platforms.length === 0) {
        throw new BadRequestException(
          `Screen "${s.screen_key}" must grant at least one platform`,
        );
      }
      const seenPlatforms = new Set<string>();
      for (const p of s.allowed_platforms) {
        if (seenPlatforms.has(p)) {
          throw new BadRequestException(
            `Duplicate platform "${p}" on screen "${s.screen_key}"`,
          );
        }
        seenPlatforms.add(p);
        if (!def.platforms.includes(p as (typeof def.platforms)[number])) {
          throw new BadRequestException(
            `Platform "${p}" is not declared on screen "${s.screen_key}"`,
          );
        }
      }
    }
  }

  private validateAttributesAgainstRole(
    attributes: {
      screen_key: string;
      attribute_key: string;
      value: unknown;
    }[],
    roleScreens: RoleScreen[],
  ): void {
    const screenKeysOnRole = new Set(roleScreens.map((s) => s.screen_key));

    // 1. Every supplied (screen, attr) is on the role and the catalog.
    const seenPairs = new Set<string>();
    for (const attr of attributes) {
      const pair = `${attr.screen_key}::${attr.attribute_key}`;
      if (seenPairs.has(pair)) {
        throw new BadRequestException(
          `Duplicate attribute "${attr.attribute_key}" for screen "${attr.screen_key}"`,
        );
      }
      seenPairs.add(pair);

      if (!screenKeysOnRole.has(attr.screen_key)) {
        throw new BadRequestException(
          `Screen "${attr.screen_key}" is not part of this role`,
        );
      }
      const screenDef = this.catalog.getScreen(attr.screen_key);
      if (!screenDef) {
        throw new BadRequestException(
          `Unknown screen "${attr.screen_key}" in catalog`,
        );
      }
      const attrDef = screenDef.attributes.find(
        (a) => a.key === attr.attribute_key,
      );
      if (!attrDef) {
        throw new BadRequestException(
          `Attribute "${attr.attribute_key}" is not declared on screen "${attr.screen_key}"`,
        );
      }

      // Validate value shape — wildcard "all" is a separate accepted shape
      // when (and only when) the catalog declares allow_all on this attribute.
      if (isWildcardAll(attr.value)) {
        if (!attrDef.allow_all) {
          throw new BadRequestException(
            `Attribute "${attr.attribute_key}" on "${attr.screen_key}" does not support the "all" wildcard`,
          );
        }
        // Wildcard always counts as "provided" for required-check purposes.
      } else if (attrDef.multi) {
        if (!Array.isArray(attr.value)) {
          throw new BadRequestException(
            `Attribute "${attr.attribute_key}" on "${attr.screen_key}" must be an array`,
          );
        }
        if (attr.value.length === 0 && attrDef.required) {
          throw new BadRequestException(
            `Attribute "${attr.attribute_key}" on "${attr.screen_key}" is required`,
          );
        }
      } else {
        if (Array.isArray(attr.value)) {
          throw new BadRequestException(
            `Attribute "${attr.attribute_key}" on "${attr.screen_key}" must be a single value, not an array`,
          );
        }
        if ((attr.value === null || attr.value === undefined) && attrDef.required) {
          throw new BadRequestException(
            `Attribute "${attr.attribute_key}" on "${attr.screen_key}" is required`,
          );
        }
      }
    }

    // 2. Every required attribute on every role screen has a value.
    for (const roleScreen of roleScreens) {
      const screenDef = this.catalog.getScreen(roleScreen.screen_key);
      if (!screenDef) continue;
      for (const attrDef of screenDef.attributes) {
        if (!attrDef.required) continue;
        const supplied = attributes.find(
          (a) =>
            a.screen_key === roleScreen.screen_key &&
            a.attribute_key === attrDef.key,
        );
        if (!supplied) {
          throw new BadRequestException(
            `Attribute "${attrDef.key}" is required on screen "${roleScreen.screen_key}"`,
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Detail mappers
  // ---------------------------------------------------------------------------

  private toRoleDetail(
    role: Role,
    screens: RoleScreen[],
    activeAssignmentCount: number,
  ): RoleDetail {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      role_type_keys: role.role_type_keys,
      is_active: role.is_active,
      active_assignment_count: activeAssignmentCount,
      screens: screens.map((s) => {
        // Defensive default — rows that pre-date allowed_platforms (or were
        // inserted before the migration ran) come back without the field.
        // Fall back to the catalog's full platform set so legacy roles
        // behave as they did before the column existed.
        const def = this.catalog.getScreen(s.screen_key);
        const allowed_platforms =
          s.allowed_platforms && s.allowed_platforms.length > 0
            ? s.allowed_platforms
            : def
              ? [...def.platforms]
              : [];
        return {
          screen_key: s.screen_key,
          allowed_actions: s.allowed_actions,
          allowed_platforms,
        };
      }),
      created_at: role.created_at,
      updated_at: role.updated_at,
    };
  }

  /**
   * Count assignments referencing this role. Assignments are hard-deleted on
   * revoke, so every row found here is live by definition.
   */
  private async countActiveAssignments(roleId: number): Promise<number> {
    return this.assignments.count({ where: { role_id: roleId } });
  }

  /** Aggregate assignments for a batch of roles in one query. */
  private async countActiveAssignmentsByRole(
    roleIds: number[],
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (roleIds.length === 0) return counts;
    const rows: { role_id: string | number; cnt: string | number }[] =
      await this.assignments
        .createQueryBuilder('a')
        .select('a.role_id', 'role_id')
        .addSelect('COUNT(*)', 'cnt')
        .where('a.role_id IN (:...ids)', { ids: roleIds })
        .groupBy('a.role_id')
        .getRawMany();
    for (const r of rows) {
      counts.set(Number(r.role_id), Number(r.cnt));
    }
    return counts;
  }

  private toAssignmentDetail(
    assignment: RoleAssignment,
    attrs: RoleAssignmentAttribute[],
  ): AssignmentDetail {
    return {
      id: assignment.id,
      role_id: assignment.role_id,
      role_code: assignment.role?.code ?? '',
      role_name: assignment.role?.name ?? '',
      employee_id: assignment.employee_id,
      employee_emp_code: assignment.employee?.emp_code ?? '',
      employee_display_name: assignment.employee?.emp_display_name ?? '',
      attributes: attrs.map((a) => ({
        screen_key: a.screen_key,
        attribute_key: a.attribute_key,
        value: a.value,
      })),
      created_at: assignment.created_at,
      updated_at: assignment.updated_at,
    };
  }
}
