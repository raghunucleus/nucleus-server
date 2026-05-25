import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DepartmentsSortField } from '../dto/list-departments.dto';
import { Department } from '../entities/department.entity';
import { Employee } from '../entities/employee.entity';

export interface ListDepartmentsResult {
  rows: Department[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<DepartmentsSortField, string> = {
  name: 'name',
  code: 'code',
  short_name: 'short_name',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateDepartmentInput {
  name: string;
  code: string;
  short_name: string;
  hod_employee_id?: number | null;
}

interface UpdateDepartmentInput {
  name?: string;
  code?: string;
  short_name?: string;
  hod_employee_id?: number | null;
}

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: DepartmentsSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    shortNameSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListDepartmentsResult> {
    const qb = this.departments
      .createQueryBuilder('d')
      .leftJoin('d.hod', 'hod')
      .addSelect(['hod.id', 'hod.emp_code', 'hod.emp_display_name']);

    if (opts.nameSearch) {
      qb.andWhere('LOWER(d.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.codeSearch) {
      qb.andWhere('LOWER(d.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }

    if (opts.shortNameSearch) {
      qb.andWhere('LOWER(d.short_name) LIKE :sn', {
        sn: `%${opts.shortNameSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('d.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('d.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`d.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('d.id', 'ASC')
      .skip((opts.page - 1) * opts.pageSize)
      .take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();
    return {
      rows,
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
    };
  }

  async getOne(id: number): Promise<Department> {
    const department = await this.departments
      .createQueryBuilder('d')
      .leftJoin('d.hod', 'hod')
      .addSelect(['hod.id', 'hod.emp_code', 'hod.emp_display_name'])
      .where('d.id = :id', { id })
      .getOne();
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  async create(input: CreateDepartmentInput): Promise<Department> {
    await this.assertUnique({
      name: input.name,
      code: input.code,
      short_name: input.short_name,
    });

    if (input.hod_employee_id !== undefined && input.hod_employee_id !== null) {
      await this.assertEmployeeExists(input.hod_employee_id);
    }

    const department = this.departments.create({
      name: input.name,
      code: input.code,
      short_name: input.short_name,
      hod_employee_id: input.hod_employee_id ?? null,
      is_active: true,
    });
    const saved = await this.departments.save(department);
    return this.getOne(saved.id);
  }

  async update(id: number, patch: UpdateDepartmentInput): Promise<Department> {
    const department = await this.departments.findOne({ where: { id } });
    if (!department) throw new NotFoundException('Department not found');

    await this.assertUnique({
      name:
        patch.name !== undefined && patch.name !== department.name
          ? patch.name
          : undefined,
      code:
        patch.code !== undefined && patch.code !== department.code
          ? patch.code
          : undefined,
      short_name:
        patch.short_name !== undefined && patch.short_name !== department.short_name
          ? patch.short_name
          : undefined,
      excludeId: id,
    });

    if (
      patch.hod_employee_id !== undefined &&
      patch.hod_employee_id !== null &&
      patch.hod_employee_id !== department.hod_employee_id
    ) {
      await this.assertEmployeeExists(patch.hod_employee_id);
    }

    if (patch.name !== undefined) department.name = patch.name;
    if (patch.code !== undefined) department.code = patch.code;
    if (patch.short_name !== undefined) department.short_name = patch.short_name;
    if (patch.hod_employee_id !== undefined)
      department.hod_employee_id = patch.hod_employee_id;

    await this.departments.save(department);
    return this.getOne(id);
  }

  async setActive(id: number, active: boolean): Promise<Department> {
    const department = await this.departments.findOne({ where: { id } });
    if (!department) throw new NotFoundException('Department not found');

    if (department.is_active === active) return this.getOne(id);

    department.is_active = active;
    await this.departments.save(department);
    return this.getOne(id);
  }

  private async assertEmployeeExists(employeeId: number): Promise<void> {
    const employee = await this.employees.findOne({
      where: { id: employeeId },
      select: { id: true },
    });
    if (!employee) throw new BadRequestException('HOD employee not found');
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    short_name?: string;
    excludeId?: number;
  }): Promise<void> {
    const checks: { field: 'name' | 'code' | 'short_name'; value: string; message: string }[] = [];
    if (opts.name !== undefined)
      checks.push({ field: 'name', value: opts.name, message: 'Name is already in use' });
    if (opts.code !== undefined)
      checks.push({ field: 'code', value: opts.code, message: 'Code is already in use' });
    if (opts.short_name !== undefined)
      checks.push({
        field: 'short_name',
        value: opts.short_name,
        message: 'Short name is already in use',
      });

    for (const c of checks) {
      const qb = this.departments
        .createQueryBuilder('d')
        .where(`LOWER(d.${c.field}) = LOWER(:v)`, { v: c.value });
      if (opts.excludeId) qb.andWhere('d.id != :id', { id: opts.excludeId });
      const collision = await qb.getOne();
      if (collision) throw new ConflictException(c.message);
    }
  }
}
