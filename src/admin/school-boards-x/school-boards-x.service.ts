import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SchoolBoardsXSortField } from '../dto/list-school-boards-x.dto';
import { SchoolBoardX } from '../entities/school-board-x.entity';

export interface ListSchoolBoardsXResult {
  rows: SchoolBoardX[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<SchoolBoardsXSortField, string> = {
  name: 'name',
  code: 'code',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateSchoolBoardXInput {
  name: string;
  code: string;
  description?: string | null;
}

interface UpdateSchoolBoardXInput {
  name?: string;
  code?: string;
  description?: string | null;
}

@Injectable()
export class SchoolBoardsXService {
  constructor(
    @InjectRepository(SchoolBoardX)
    private readonly boards: Repository<SchoolBoardX>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: SchoolBoardsXSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListSchoolBoardsXResult> {
    const qb = this.boards.createQueryBuilder('e');

    if (opts.nameSearch) {
      qb.andWhere('LOWER(e.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.codeSearch) {
      qb.andWhere('LOWER(e.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('e.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('e.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`e.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('e.id', 'ASC')
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

  async getOne(id: number): Promise<SchoolBoardX> {
    const row = await this.boards.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Xth board not found');
    return row;
  }

  async create(input: CreateSchoolBoardXInput): Promise<SchoolBoardX> {
    await this.assertUnique({ name: input.name, code: input.code });

    // Admin-created boards are active immediately. Only the migration's bulk
    // catalogue seed ships dormant — see education-boards.seed.ts.
    const row = this.boards.create({
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      is_active: true,
    });
    return this.boards.save(row);
  }

  async update(
    id: number,
    patch: UpdateSchoolBoardXInput,
  ): Promise<SchoolBoardX> {
    const row = await this.boards.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Xth board not found');

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

    // `!== undefined` (not `!= null`): an explicit null clears the column,
    // while an absent key leaves it untouched.
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.code !== undefined) row.code = patch.code;
    if (patch.description !== undefined) row.description = patch.description;

    return this.boards.save(row);
  }

  async setActive(id: number, active: boolean): Promise<SchoolBoardX> {
    const row = await this.boards.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Xth board not found');

    if (row.is_active === active) return row;

    row.is_active = active;
    return this.boards.save(row);
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    excludeId?: number;
  }): Promise<void> {
    if (opts.name !== undefined) {
      const qb = this.boards
        .createQueryBuilder('e')
        .where('LOWER(e.name) = LOWER(:v)', { v: opts.name });
      if (opts.excludeId !== undefined)
        qb.andWhere('e.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Name is already in use');
    }
    if (opts.code !== undefined) {
      const qb = this.boards
        .createQueryBuilder('e')
        .where('LOWER(e.code) = LOWER(:v)', { v: opts.code });
      if (opts.excludeId !== undefined)
        qb.andWhere('e.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Code is already in use');
    }
  }
}
