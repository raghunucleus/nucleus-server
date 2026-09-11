import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import {
  AccountInviteService,
  AccountStatusView,
} from '../../account-invites/account-invite.service';
import {
  AuthSessionsService,
  SessionRow,
} from '../../auth-sessions/auth-sessions.service';
import { DEFAULT_DEVICE_LIMIT } from '../../auth-sessions/session.constants';
import { EmployeeAuthService } from '../../employee/auth/employee-auth.service';
import type { EmployeesSortField } from '../dto/list-employees.dto';
import { Department } from '../entities/department.entity';
import { Designation } from '../entities/designation.entity';
import { Employee } from '../entities/employee.entity';

export interface ListEmployeesResult {
  rows: Employee[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Account/invite state per row id — a sibling map, keeping `rows` clean. */
  account_status: Record<number, AccountStatusView>;
}

const SORT_COLUMN: Record<EmployeesSortField, string> = {
  emp_code: 'emp_code',
  emp_display_name: 'emp_display_name',
  gender: 'gender',
  mobile_number: 'mobile_number',
  email: 'email',
  rm_emp_code: 'rm_emp_code',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateEmployeeInput {
  emp_code: string;
  emp_display_name: string;
  gender: string;
  dob: string | null;
  department_id: number;
  designation_id: number;
  mobile_number: string;
  country_code: string;
  email: string;
  rm_emp_code: string | null;
  device_limit?: number | null;
}

/** The admin sessions view: the devices plus the limit they count against. */
export interface EmployeeSessionsView {
  limit: number;
  /** True when `limit` is the global default (no per-employee override). */
  is_default_limit: boolean;
  sessions: SessionRow[];
}

interface UpdateEmployeeInput {
  emp_code?: string;
  emp_display_name?: string;
  gender?: string;
  dob?: string | null;
  department_id?: number;
  designation_id?: number;
  mobile_number?: string;
  country_code?: string;
  email?: string;
  rm_emp_code?: string | null;
  device_limit?: number | null;
}

export interface BulkRowError {
  rowIndex: number;
  field?: string;
  message: string;
}

export interface BulkCreateRow {
  emp_code: string;
  emp_display_name: string;
  gender: string;
  dob: string | null;
  department_code: string;
  designation_code: string;
  mobile_number: string;
  country_code: string;
  email: string;
  rm_emp_code: string | null;
}

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(Designation)
    private readonly designations: Repository<Designation>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly employeeAuth: EmployeeAuthService,
    private readonly invites: AccountInviteService,
    private readonly sessions: AuthSessionsService,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: EmployeesSortField;
    sortOrder: 'asc' | 'desc';
    q?: string;
    empCodeSearch?: string;
    displayNameSearch?: string;
    emailSearch?: string;
    mobileSearch?: string;
    rmEmpCodeSearch?: string;
    status?: 'active' | 'inactive';
    gender?: string;
    departmentId?: number;
    designationId?: number;
  }): Promise<ListEmployeesResult> {
    const qb = this.employees
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.department', 'department')
      .leftJoinAndSelect('e.designation', 'designation');

    // Single-box typeahead used by the employee pickers. OR-matched so one
    // keystroke stream can find a person by code, name, or email.
    if (opts.q) {
      const q = `%${opts.q.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('LOWER(e.emp_code) LIKE :q', { q })
            .orWhere('LOWER(e.emp_display_name) LIKE :q', { q })
            .orWhere('LOWER(e.email) LIKE :q', { q });
        }),
      );
    }

    if (opts.empCodeSearch) {
      qb.andWhere('LOWER(e.emp_code) LIKE :ec', {
        ec: `%${opts.empCodeSearch.toLowerCase()}%`,
      });
    }

    if (opts.displayNameSearch) {
      qb.andWhere('LOWER(e.emp_display_name) LIKE :dn', {
        dn: `%${opts.displayNameSearch.toLowerCase()}%`,
      });
    }

    if (opts.emailSearch) {
      qb.andWhere('LOWER(e.email) LIKE :em', {
        em: `%${opts.emailSearch.toLowerCase()}%`,
      });
    }

    if (opts.mobileSearch) {
      qb.andWhere('e.mobile_number LIKE :mb', {
        mb: `%${opts.mobileSearch}%`,
      });
    }

    if (opts.rmEmpCodeSearch) {
      qb.andWhere('LOWER(e.rm_emp_code) LIKE :rm', {
        rm: `%${opts.rmEmpCodeSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('e.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('e.is_active = FALSE');
    }

    if (opts.gender) {
      qb.andWhere('e.gender = :g', { g: opts.gender });
    }

    if (opts.departmentId) {
      qb.andWhere('e.department_id = :di', { di: opts.departmentId });
    }

    if (opts.designationId) {
      qb.andWhere('e.designation_id = :dsi', { dsi: opts.designationId });
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`e.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('e.id', 'ASC')
      .skip((opts.page - 1) * opts.pageSize)
      .take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();
    // One extra query for the whole page, keyed on the ids we just fetched —
    // the account column would otherwise be an N+1.
    const account_status = await this.invites.getStatuses(
      'employee',
      rows.map((r) => r.id),
    );
    return {
      rows,
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
      account_status,
    };
  }

  async getOne(id: number): Promise<Employee> {
    const employee = await this.employees.findOne({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  /**
   * Returns every emp_code in the table. Used by the bulk-upload validator to
   * confirm rm_emp_code references without paginating through the full list
   * employee endpoint.
   */
  async listEmpCodes(): Promise<string[]> {
    const rows = await this.employees
      .createQueryBuilder('e')
      .select('e.emp_code', 'emp_code')
      .getRawMany<{ emp_code: string }>();
    return rows.map((r) => r.emp_code);
  }

  async create(input: CreateEmployeeInput): Promise<Employee> {
    await this.assertReferencesExist({
      department_id: input.department_id,
      designation_id: input.designation_id,
      rm_emp_code: input.rm_emp_code,
    });

    await this.assertUnique({
      emp_code: input.emp_code,
      email: input.email,
      mobile: {
        country_code: input.country_code,
        mobile_number: input.mobile_number,
      },
    });

    const employee = this.employees.create({
      emp_code: input.emp_code,
      emp_display_name: input.emp_display_name,
      gender: input.gender,
      dob: input.dob,
      department_id: input.department_id,
      designation_id: input.designation_id,
      mobile_number: input.mobile_number,
      country_code: input.country_code,
      email: input.email,
      rm_emp_code: input.rm_emp_code,
      device_limit: input.device_limit ?? null,
      is_active: true,
    });
    return this.employees.save(employee);
  }

  async update(id: number, patch: UpdateEmployeeInput): Promise<Employee> {
    const employee = await this.employees.findOne({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');

    await this.assertReferencesExist({
      department_id:
        patch.department_id !== undefined &&
        patch.department_id !== employee.department_id
          ? patch.department_id
          : undefined,
      designation_id:
        patch.designation_id !== undefined &&
        patch.designation_id !== employee.designation_id
          ? patch.designation_id
          : undefined,
      rm_emp_code:
        patch.rm_emp_code !== undefined &&
        patch.rm_emp_code !== employee.rm_emp_code
          ? patch.rm_emp_code
          : undefined,
      selfEmpCode: patch.emp_code ?? employee.emp_code,
    });

    const nextCountryCode =
      patch.country_code !== undefined
        ? patch.country_code
        : employee.country_code;
    const nextMobile =
      patch.mobile_number !== undefined
        ? patch.mobile_number
        : employee.mobile_number;
    const mobileChanged =
      nextCountryCode !== employee.country_code ||
      nextMobile !== employee.mobile_number;

    await this.assertUnique({
      emp_code:
        patch.emp_code !== undefined && patch.emp_code !== employee.emp_code
          ? patch.emp_code
          : undefined,
      email:
        patch.email !== undefined && patch.email !== employee.email
          ? patch.email
          : undefined,
      mobile: mobileChanged
        ? { country_code: nextCountryCode, mobile_number: nextMobile }
        : undefined,
      excludeId: id,
    });

    if (patch.emp_code !== undefined) employee.emp_code = patch.emp_code;
    if (patch.emp_display_name !== undefined)
      employee.emp_display_name = patch.emp_display_name;
    if (patch.gender !== undefined) employee.gender = patch.gender;
    if (patch.dob !== undefined) employee.dob = patch.dob;
    if (patch.department_id !== undefined)
      employee.department_id = patch.department_id;
    if (patch.designation_id !== undefined)
      employee.designation_id = patch.designation_id;
    if (patch.mobile_number !== undefined)
      employee.mobile_number = patch.mobile_number;
    if (patch.country_code !== undefined)
      employee.country_code = patch.country_code;
    if (patch.email !== undefined) employee.email = patch.email;
    if (patch.rm_emp_code !== undefined)
      employee.rm_emp_code = patch.rm_emp_code;
    // null resets to the default. Lowering it never evicts a signed-in
    // device; the new limit applies at the next login.
    if (patch.device_limit !== undefined)
      employee.device_limit = patch.device_limit;

    return this.employees.save(employee);
  }

  async setActive(id: number, active: boolean): Promise<Employee> {
    const employee = await this.employees.findOne({ where: { id } });
    if (!employee) throw new NotFoundException('Employee not found');

    if (employee.is_active === active) return employee;

    employee.is_active = active;
    const saved = await this.employees.save(employee);
    // Deactivation takes effect now, not at the next refresh: every device is
    // signed out (its next request is refused and its sockets drop).
    if (!active) {
      await this.sessions.revokeAllExcept('employee', id, null, 'deactivated');
    }
    return saved;
  }

  /** The employee's signed-in devices, IP included (admin view). */
  async listSessions(id: number): Promise<EmployeeSessionsView> {
    const employee = await this.employees.findOne({
      where: { id },
      select: { id: true, device_limit: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return {
      limit: employee.device_limit ?? DEFAULT_DEVICE_LIMIT,
      is_default_limit: employee.device_limit === null,
      sessions: await this.sessions.list('employee', id, { includeIp: true }),
    };
  }

  /** Force-sign-out one of the employee's devices. */
  async revokeSession(id: number, sessionId: string): Promise<void> {
    const found = await this.employees.exists({ where: { id } });
    if (!found) throw new NotFoundException('Employee not found');
    const ok = await this.sessions.revokeById(
      'employee',
      id,
      sessionId,
      'admin',
    );
    if (!ok) throw new NotFoundException('Session not found');
  }

  /**
   * Provision (or reset) the employee's login: generates a random temporary
   * password, emails it to their registered address, forces a change on first
   * login, and revokes any sessions the account currently holds. Used both for
   * the very first invite and for "reset password" later.
   */
  async resetLoginPassword(id: number): Promise<{ email: string }> {
    const employee = await this.employees.findOne({
      where: { id },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    // Kill any outstanding invitation first. Otherwise a live invite link
    // would still be clickable days later and would silently overwrite the
    // temporary password we are about to email.
    await this.invites.revokeOutstanding('employee', id);
    return this.employeeAuth.adminResetPassword(id);
  }

  /**
   * Directly set the employee's login password to an admin-chosen value. No
   * email is sent; the employee is still forced to change it on first sign-in.
   */
  async setLoginPassword(id: number, password: string): Promise<void> {
    const employee = await this.employees.findOne({
      where: { id },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    await this.invites.revokeOutstanding('employee', id);
    await this.employeeAuth.adminSetPassword(id, password);
  }

  private async assertReferencesExist(opts: {
    department_id?: number;
    designation_id?: number;
    rm_emp_code?: string | null;
    selfEmpCode?: string;
  }): Promise<void> {
    if (opts.department_id !== undefined) {
      const dept = await this.departments.findOne({
        where: { id: opts.department_id },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('Department not found');
    }

    if (opts.designation_id !== undefined) {
      const desig = await this.designations.findOne({
        where: { id: opts.designation_id },
        select: { id: true },
      });
      if (!desig) throw new BadRequestException('Designation not found');
    }

    if (opts.rm_emp_code !== undefined && opts.rm_emp_code !== null) {
      if (opts.selfEmpCode && opts.rm_emp_code === opts.selfEmpCode) {
        throw new BadRequestException(
          'Reporting manager cannot be the employee themselves',
        );
      }
      const rm = await this.employees.findOne({
        where: { emp_code: opts.rm_emp_code },
      });
      if (!rm) throw new BadRequestException('Reporting manager not found');
    }
  }

  private async assertUnique(opts: {
    emp_code?: string;
    email?: string;
    mobile?: { country_code: string; mobile_number: string };
    excludeId?: number;
  }): Promise<void> {
    if (opts.emp_code !== undefined) {
      const qb = this.employees
        .createQueryBuilder('e')
        .where('LOWER(e.emp_code) = LOWER(:v)', { v: opts.emp_code });
      if (opts.excludeId) qb.andWhere('e.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Employee code is already in use');
    }

    if (opts.email !== undefined) {
      const qb = this.employees
        .createQueryBuilder('e')
        .where('LOWER(e.email) = LOWER(:v)', { v: opts.email });
      if (opts.excludeId) qb.andWhere('e.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Email is already in use');
    }

    if (opts.mobile !== undefined) {
      const qb = this.employees
        .createQueryBuilder('e')
        .where('e.country_code = :cc', { cc: opts.mobile.country_code })
        .andWhere('e.mobile_number = :mn', { mn: opts.mobile.mobile_number });
      if (opts.excludeId) qb.andWhere('e.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Mobile number is already in use');
    }
  }

  /**
   * Insert a batch of employees atomically. Validates everything that can be
   * checked up front (intra-batch dupes, code resolution, existing-DB
   * conflicts, rm_emp_code references) and returns per-row errors without
   * touching the DB if any are found. On commit, all rows are inserted in a
   * single transaction; the rm_emp_code FK is satisfied via a second-pass
   * UPDATE so references within the same batch work regardless of row order.
   */
  async bulkCreate(rows: BulkCreateRow[]): Promise<{ created: number }> {
    if (rows.length === 0) return { created: 0 };

    const errors: BulkRowError[] = [];

    // 1. Resolve department + designation codes to ids in one query each.
    const deptCodes = uniqueUpper(rows.map((r) => r.department_code));
    const desigCodes = uniqueUpper(rows.map((r) => r.designation_code));

    const [depts, desigs] = await Promise.all([
      this.departments.find({ where: { code: In(deptCodes) } }),
      this.designations.find({ where: { code: In(desigCodes) } }),
    ]);

    const deptByCode = new Map(depts.map((d) => [d.code.toUpperCase(), d]));
    const desigByCode = new Map(desigs.map((d) => [d.code.toUpperCase(), d]));

    rows.forEach((r, i) => {
      if (!deptByCode.has(r.department_code.toUpperCase())) {
        errors.push({
          rowIndex: i,
          field: 'department_code',
          message: `Department code "${r.department_code}" not found`,
        });
      }
      if (!desigByCode.has(r.designation_code.toUpperCase())) {
        errors.push({
          rowIndex: i,
          field: 'designation_code',
          message: `Designation code "${r.designation_code}" not found`,
        });
      }
    });

    // 2. Intra-batch duplicates.
    seenAt(rows, (r) => r.emp_code.toUpperCase()).forEach((indices, key) => {
      if (indices.length > 1) {
        for (const i of indices) {
          errors.push({
            rowIndex: i,
            field: 'emp_code',
            message: `Duplicate emp_code "${key}" in batch (rows ${indices.map((n) => n + 1).join(', ')})`,
          });
        }
      }
    });

    seenAt(rows, (r) => r.email.toLowerCase()).forEach((indices, key) => {
      if (indices.length > 1) {
        for (const i of indices) {
          errors.push({
            rowIndex: i,
            field: 'email',
            message: `Duplicate email "${key}" in batch (rows ${indices.map((n) => n + 1).join(', ')})`,
          });
        }
      }
    });

    seenAt(rows, (r) => `${r.country_code}::${r.mobile_number}`).forEach(
      (indices, key) => {
        if (indices.length > 1) {
          const display = key.replace('::', ' ');
          for (const i of indices) {
            errors.push({
              rowIndex: i,
              field: 'mobile_number',
              message: `Duplicate mobile "${display}" in batch (rows ${indices.map((n) => n + 1).join(', ')})`,
            });
          }
        }
      },
    );

    // 3. Conflicts with existing employees.
    const empCodes = rows.map((r) => r.emp_code);
    const emails = rows.map((r) => r.email);

    const [existingByCodeRows, existingByEmailRows] = await Promise.all([
      this.employees
        .createQueryBuilder('e')
        .select(['e.emp_code'])
        .where('e.emp_code IN (:...codes)', { codes: empCodes })
        .getMany(),
      this.employees
        .createQueryBuilder('e')
        .select(['e.email'])
        .where('LOWER(e.email) IN (:...emails)', { emails })
        .getMany(),
    ]);

    const existingByEmpCode = new Set(
      existingByCodeRows.map((e) => e.emp_code.toUpperCase()),
    );
    const existingByEmail = new Set(
      existingByEmailRows.map((e) => e.email.toLowerCase()),
    );

    // Mobile pairs: check each combination by composing one WHERE clause per row.
    const mobileQb = this.employees
      .createQueryBuilder('e')
      .select(['e.country_code', 'e.mobile_number']);
    const mobileFragments: string[] = [];
    const mobileParams: Record<string, string> = {};
    rows.forEach((r, i) => {
      mobileFragments.push(
        `(e.country_code = :cc${i} AND e.mobile_number = :mn${i})`,
      );
      mobileParams[`cc${i}`] = r.country_code;
      mobileParams[`mn${i}`] = r.mobile_number;
    });
    const existingByMobile = new Set<string>();
    if (mobileFragments.length > 0) {
      const mobileHits = await mobileQb
        .where(`(${mobileFragments.join(' OR ')})`, mobileParams)
        .getMany();
      for (const m of mobileHits)
        existingByMobile.add(`${m.country_code}::${m.mobile_number}`);
    }

    rows.forEach((r, i) => {
      if (existingByEmpCode.has(r.emp_code.toUpperCase())) {
        errors.push({
          rowIndex: i,
          field: 'emp_code',
          message: `emp_code "${r.emp_code}" already exists`,
        });
      }
      if (existingByEmail.has(r.email.toLowerCase())) {
        errors.push({
          rowIndex: i,
          field: 'email',
          message: `email "${r.email}" already exists`,
        });
      }
      if (existingByMobile.has(`${r.country_code}::${r.mobile_number}`)) {
        errors.push({
          rowIndex: i,
          field: 'mobile_number',
          message: `mobile "${r.country_code} ${r.mobile_number}" already exists`,
        });
      }
    });

    // 4. rm_emp_code must point to an emp_code in this batch or in the DB,
    // and must not be self.
    const batchEmpCodes = new Set(rows.map((r) => r.emp_code.toUpperCase()));
    const rmCodesToCheck = new Set<string>();
    rows.forEach((r) => {
      if (r.rm_emp_code) {
        const up = r.rm_emp_code.toUpperCase();
        if (!batchEmpCodes.has(up)) rmCodesToCheck.add(up);
      }
    });

    const rmExistInDb = new Set<string>();
    if (rmCodesToCheck.size > 0) {
      const found = await this.employees
        .createQueryBuilder('e')
        .select(['e.emp_code'])
        .where('e.emp_code IN (:...codes)', {
          codes: Array.from(rmCodesToCheck),
        })
        .getMany();
      for (const f of found) rmExistInDb.add(f.emp_code.toUpperCase());
    }

    rows.forEach((r, i) => {
      if (!r.rm_emp_code) return;
      const up = r.rm_emp_code.toUpperCase();
      if (up === r.emp_code.toUpperCase()) {
        errors.push({
          rowIndex: i,
          field: 'rm_emp_code',
          message: 'Reporting manager cannot be the employee themselves',
        });
        return;
      }
      if (!batchEmpCodes.has(up) && !rmExistInDb.has(up)) {
        errors.push({
          rowIndex: i,
          field: 'rm_emp_code',
          message: `Reporting manager "${r.rm_emp_code}" not found`,
        });
      }
    });

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Bulk validation failed',
        rowErrors: errors,
      });
    }

    // 5. Insert atomically. Pass 1 inserts with rm_emp_code = NULL so FK
    // ordering across the batch never matters; pass 2 sets the managers.
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Employee);
      const created: Employee[] = [];
      for (const r of rows) {
        const dept = deptByCode.get(r.department_code.toUpperCase())!;
        const desig = desigByCode.get(r.designation_code.toUpperCase())!;
        const entity = repo.create({
          emp_code: r.emp_code,
          emp_display_name: r.emp_display_name,
          gender: r.gender,
          dob: r.dob,
          department_id: dept.id,
          designation_id: desig.id,
          mobile_number: r.mobile_number,
          country_code: r.country_code,
          email: r.email,
          rm_emp_code: null,
          is_active: true,
        });
        created.push(await repo.save(entity));
      }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.rm_emp_code) {
          await repo.update(
            { id: created[i].id },
            { rm_emp_code: r.rm_emp_code },
          );
        }
      }

      return { created: created.length };
    });
  }
}

function uniqueUpper(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.toUpperCase())));
}

function seenAt<T>(
  rows: T[],
  keyFn: (row: T) => string,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const key = keyFn(row);
    const list = out.get(key) ?? [];
    list.push(i);
    out.set(key, list);
  });
  return out;
}
