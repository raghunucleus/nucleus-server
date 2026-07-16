import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntranceExamsSortField } from '../dto/list-entrance-exams.dto';
import { EntranceExam } from '../entities/entrance-exam.entity';

export interface ListEntranceExamsResult {
  rows: EntranceExam[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<EntranceExamsSortField, string> = {
  name: 'name',
  code: 'code',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateEntranceExamInput {
  name: string;
  code: string;
  description?: string | null;
}

interface UpdateEntranceExamInput {
  name?: string;
  code?: string;
  description?: string | null;
}

@Injectable()
export class EntranceExamsService {
  constructor(
    @InjectRepository(EntranceExam)
    private readonly exams: Repository<EntranceExam>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: EntranceExamsSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListEntranceExamsResult> {
    const qb = this.exams.createQueryBuilder('e');

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

  async getOne(id: number): Promise<EntranceExam> {
    const row = await this.exams.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Entrance exam not found');
    return row;
  }

  async create(input: CreateEntranceExamInput): Promise<EntranceExam> {
    await this.assertUnique({ name: input.name, code: input.code });

    const row = this.exams.create({
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      is_active: true,
    });
    return this.exams.save(row);
  }

  async update(
    id: number,
    patch: UpdateEntranceExamInput,
  ): Promise<EntranceExam> {
    const row = await this.exams.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Entrance exam not found');

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

    return this.exams.save(row);
  }

  async setActive(id: number, active: boolean): Promise<EntranceExam> {
    const row = await this.exams.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Entrance exam not found');

    if (row.is_active === active) return row;

    row.is_active = active;
    return this.exams.save(row);
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    excludeId?: number;
  }): Promise<void> {
    if (opts.name !== undefined) {
      const qb = this.exams
        .createQueryBuilder('e')
        .where('LOWER(e.name) = LOWER(:v)', { v: opts.name });
      if (opts.excludeId !== undefined)
        qb.andWhere('e.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Name is already in use');
    }
    if (opts.code !== undefined) {
      const qb = this.exams
        .createQueryBuilder('e')
        .where('LOWER(e.code) = LOWER(:v)', { v: opts.code });
      if (opts.excludeId !== undefined)
        qb.andWhere('e.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Code is already in use');
    }
  }
}
