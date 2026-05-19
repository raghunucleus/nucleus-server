import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DesignationsSortField } from '../dto/list-designations.dto';
import { Designation } from '../entities/designation.entity';

export interface ListDesignationsResult {
  rows: Designation[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<DesignationsSortField, string> = {
  name: 'name',
  code: 'code',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateDesignationInput {
  name: string;
  code: string;
}

interface UpdateDesignationInput {
  name?: string;
  code?: string;
}

@Injectable()
export class DesignationsService {
  constructor(
    @InjectRepository(Designation)
    private readonly designations: Repository<Designation>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: DesignationsSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListDesignationsResult> {
    const qb = this.designations.createQueryBuilder('d');

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

  async getOne(id: number): Promise<Designation> {
    const designation = await this.designations.findOne({ where: { id } });
    if (!designation) throw new NotFoundException('Designation not found');
    return designation;
  }

  async create(input: CreateDesignationInput): Promise<Designation> {
    await this.assertUnique({ name: input.name, code: input.code });

    const designation = this.designations.create({
      name: input.name,
      code: input.code,
      is_active: true,
    });
    return this.designations.save(designation);
  }

  async update(id: number, patch: UpdateDesignationInput): Promise<Designation> {
    const designation = await this.designations.findOne({ where: { id } });
    if (!designation) throw new NotFoundException('Designation not found');

    await this.assertUnique({
      name:
        patch.name !== undefined && patch.name !== designation.name
          ? patch.name
          : undefined,
      code:
        patch.code !== undefined && patch.code !== designation.code
          ? patch.code
          : undefined,
      excludeId: id,
    });

    if (patch.name !== undefined) designation.name = patch.name;
    if (patch.code !== undefined) designation.code = patch.code;

    return this.designations.save(designation);
  }

  async setActive(id: number, active: boolean): Promise<Designation> {
    const designation = await this.designations.findOne({ where: { id } });
    if (!designation) throw new NotFoundException('Designation not found');

    if (designation.is_active === active) return designation;

    designation.is_active = active;
    return this.designations.save(designation);
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    excludeId?: number;
  }): Promise<void> {
    const checks: { field: 'name' | 'code'; value: string; message: string }[] = [];
    if (opts.name !== undefined)
      checks.push({ field: 'name', value: opts.name, message: 'Name is already in use' });
    if (opts.code !== undefined)
      checks.push({ field: 'code', value: opts.code, message: 'Code is already in use' });

    for (const c of checks) {
      const qb = this.designations
        .createQueryBuilder('d')
        .where(`LOWER(d.${c.field}) = LOWER(:v)`, { v: c.value });
      if (opts.excludeId) qb.andWhere('d.id != :id', { id: opts.excludeId });
      const collision = await qb.getOne();
      if (collision) throw new ConflictException(c.message);
    }
  }
}
