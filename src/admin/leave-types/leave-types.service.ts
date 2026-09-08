import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { LeaveTypesSortField } from '../dto/list-leave-types.dto';
import { LeaveType } from '../entities/leave-type.entity';

export interface ListLeaveTypesResult {
  rows: LeaveType[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<LeaveTypesSortField, string> = {
  name: 'name',
  code: 'code',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateLeaveTypeInput {
  name: string;
  code: string;
}

interface UpdateLeaveTypeInput {
  name?: string;
  code?: string;
}

@Injectable()
export class LeaveTypesService {
  constructor(
    @InjectRepository(LeaveType)
    private readonly leaveTypes: Repository<LeaveType>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: LeaveTypesSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListLeaveTypesResult> {
    const qb = this.leaveTypes.createQueryBuilder('lt');

    if (opts.nameSearch) {
      qb.andWhere('LOWER(lt.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }
    if (opts.codeSearch) {
      qb.andWhere('LOWER(lt.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }
    if (opts.status === 'active') {
      qb.andWhere('lt.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('lt.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`lt.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('lt.id', 'ASC')
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

  async getOne(id: number): Promise<LeaveType> {
    const row = await this.leaveTypes.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Leave type not found');
    return row;
  }

  async create(input: CreateLeaveTypeInput): Promise<LeaveType> {
    await this.assertUnique({ name: input.name, code: input.code });
    return this.leaveTypes.save(
      this.leaveTypes.create({
        name: input.name,
        code: input.code,
        is_active: true,
      }),
    );
  }

  async update(id: number, patch: UpdateLeaveTypeInput): Promise<LeaveType> {
    const row = await this.leaveTypes.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Leave type not found');

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
    return this.leaveTypes.save(row);
  }

  async setActive(id: number, active: boolean): Promise<LeaveType> {
    const row = await this.leaveTypes.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Leave type not found');
    if (row.is_active === active) return row;
    row.is_active = active;
    return this.leaveTypes.save(row);
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    excludeId?: number;
  }): Promise<void> {
    const checks: { field: 'name' | 'code'; value: string; message: string }[] =
      [];
    if (opts.name !== undefined) {
      checks.push({
        field: 'name',
        value: opts.name,
        message: 'Name is already in use',
      });
    }
    if (opts.code !== undefined) {
      checks.push({
        field: 'code',
        value: opts.code,
        message: 'Code is already in use',
      });
    }
    for (const c of checks) {
      const qb = this.leaveTypes
        .createQueryBuilder('lt')
        .where(`LOWER(lt.${c.field}) = LOWER(:v)`, { v: c.value });
      if (opts.excludeId) qb.andWhere('lt.id != :id', { id: opts.excludeId });
      if (await qb.getOne()) throw new ConflictException(c.message);
    }
  }
}
