import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ProgrammesSortField } from '../dto/list-programmes.dto';
import { Degree } from '../entities/degree.entity';
import { Department } from '../entities/department.entity';
import { Programme } from '../entities/programme.entity';

export interface ListProgrammesResult {
  rows: Programme[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// `degree` and `department` sort by the related row's name so the table is
// alphabetically coherent for the user; the other fields map 1:1.
const SORT_COLUMN: Record<ProgrammesSortField, string> = {
  name: 'p.name',
  code: 'p.code',
  display_name: 'p.display_name',
  degree: 'degree.name',
  department: 'department.name',
  status: 'p.is_active',
  created_at: 'p.created_at',
  updated_at: 'p.updated_at',
};

interface CreateProgrammeInput {
  name: string;
  code: string;
  display_name: string;
  degree_id: number;
  department_id: number;
}

interface UpdateProgrammeInput {
  name?: string;
  code?: string;
  display_name?: string;
  degree_id?: number;
  department_id?: number;
}

@Injectable()
export class ProgrammesService {
  constructor(
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(Degree)
    private readonly degrees: Repository<Degree>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: ProgrammesSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    displayNameSearch?: string;
    status?: 'active' | 'inactive';
    degreeId?: number;
    departmentId?: number;
  }): Promise<ListProgrammesResult> {
    const qb = this.programmes
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.degree', 'degree')
      .leftJoinAndSelect('p.department', 'department');

    if (opts.nameSearch) {
      qb.andWhere('LOWER(p.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.codeSearch) {
      qb.andWhere('LOWER(p.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }

    if (opts.displayNameSearch) {
      qb.andWhere('LOWER(p.display_name) LIKE :dn', {
        dn: `%${opts.displayNameSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('p.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('p.is_active = FALSE');
    }

    if (opts.degreeId !== undefined) {
      qb.andWhere('p.degree_id = :dgid', { dgid: opts.degreeId });
    }

    if (opts.departmentId !== undefined) {
      qb.andWhere('p.department_id = :dpid', { dpid: opts.departmentId });
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(SORT_COLUMN[opts.sortBy], direction, 'NULLS LAST')
      .addOrderBy('p.id', 'ASC')
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

  async getOne(id: number): Promise<Programme> {
    const row = await this.programmes.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme not found');
    return row;
  }

  async create(input: CreateProgrammeInput): Promise<Programme> {
    await this.assertReferencesExist(input.degree_id, input.department_id);
    await this.assertUnique({ name: input.name, code: input.code });

    const row = this.programmes.create({
      name: input.name,
      code: input.code,
      display_name: input.display_name,
      degree_id: input.degree_id,
      department_id: input.department_id,
      is_active: true,
    });
    const saved = await this.programmes.save(row);
    // Re-read with relations so the response shape matches list().
    return this.getOne(saved.id);
  }

  async update(id: number, patch: UpdateProgrammeInput): Promise<Programme> {
    const row = await this.programmes.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme not found');

    if (patch.degree_id !== undefined && patch.degree_id !== row.degree_id) {
      await this.assertDegreeExists(patch.degree_id);
      row.degree_id = patch.degree_id;
    }
    if (
      patch.department_id !== undefined &&
      patch.department_id !== row.department_id
    ) {
      await this.assertDepartmentExists(patch.department_id);
      row.department_id = patch.department_id;
    }

    await this.assertUnique({
      name:
        patch.name !== undefined && patch.name !== row.name
          ? patch.name
          : undefined,
      code:
        patch.code !== undefined && patch.code !== row.code
          ? patch.code
          : undefined,
      excludeId: id,
    });

    if (patch.name !== undefined) row.name = patch.name;
    if (patch.code !== undefined) row.code = patch.code;
    if (patch.display_name !== undefined) row.display_name = patch.display_name;

    await this.programmes.save(row);
    return this.getOne(id);
  }

  async setActive(id: number, active: boolean): Promise<Programme> {
    const row = await this.programmes.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Programme not found');

    if (row.is_active === active) return row;

    row.is_active = active;
    await this.programmes.save(row);
    return this.getOne(id);
  }

  private async assertReferencesExist(
    degreeId: number,
    departmentId: number,
  ): Promise<void> {
    await this.assertDegreeExists(degreeId);
    await this.assertDepartmentExists(departmentId);
  }

  private async assertDegreeExists(degreeId: number): Promise<void> {
    const exists = await this.degrees.exists({ where: { id: degreeId } });
    if (!exists)
      throw new BadRequestException('Selected degree does not exist');
  }

  private async assertDepartmentExists(departmentId: number): Promise<void> {
    const exists = await this.departments.exists({
      where: { id: departmentId },
    });
    if (!exists)
      throw new BadRequestException('Selected department does not exist');
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    excludeId?: number;
  }): Promise<void> {
    if (opts.name !== undefined) {
      const qb = this.programmes
        .createQueryBuilder('p')
        .where('LOWER(p.name) = LOWER(:v)', { v: opts.name });
      if (opts.excludeId !== undefined)
        qb.andWhere('p.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Name is already in use');
    }
    if (opts.code !== undefined) {
      const qb = this.programmes
        .createQueryBuilder('p')
        .where('LOWER(p.code) = LOWER(:v)', { v: opts.code });
      if (opts.excludeId !== undefined)
        qb.andWhere('p.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Code is already in use');
    }
  }
}
