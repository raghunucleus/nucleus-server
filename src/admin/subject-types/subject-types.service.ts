import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SubjectTypesSortField } from '../dto/list-subject-types.dto';
import { SubjectType } from '../entities/subject-type.entity';

export interface ListSubjectTypesResult {
  rows: SubjectType[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<SubjectTypesSortField, string> = {
  name: 'name',
  code: 'code',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateSubjectTypeInput {
  name: string;
  code: string;
}

interface UpdateSubjectTypeInput {
  name?: string;
  code?: string;
}

@Injectable()
export class SubjectTypesService {
  constructor(
    @InjectRepository(SubjectType)
    private readonly subjectTypes: Repository<SubjectType>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: SubjectTypesSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListSubjectTypesResult> {
    const qb = this.subjectTypes.createQueryBuilder('st');

    if (opts.nameSearch) {
      qb.andWhere('LOWER(st.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.codeSearch) {
      qb.andWhere('LOWER(st.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('st.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('st.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`st.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('st.id', 'ASC')
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

  async getOne(id: number): Promise<SubjectType> {
    const subjectType = await this.subjectTypes.findOne({ where: { id } });
    if (!subjectType) throw new NotFoundException('Subject type not found');
    return subjectType;
  }

  async create(input: CreateSubjectTypeInput): Promise<SubjectType> {
    await this.assertUnique({ name: input.name, code: input.code });

    const subjectType = this.subjectTypes.create({
      name: input.name,
      code: input.code,
      is_active: true,
    });
    return this.subjectTypes.save(subjectType);
  }

  async update(id: number, patch: UpdateSubjectTypeInput): Promise<SubjectType> {
    const subjectType = await this.subjectTypes.findOne({ where: { id } });
    if (!subjectType) throw new NotFoundException('Subject type not found');

    await this.assertUnique({
      name:
        patch.name !== undefined && patch.name !== subjectType.name
          ? patch.name
          : undefined,
      code:
        patch.code !== undefined && patch.code !== subjectType.code
          ? patch.code
          : undefined,
      excludeId: id,
    });

    if (patch.name !== undefined) subjectType.name = patch.name;
    if (patch.code !== undefined) subjectType.code = patch.code;

    return this.subjectTypes.save(subjectType);
  }

  async setActive(id: number, active: boolean): Promise<SubjectType> {
    const subjectType = await this.subjectTypes.findOne({ where: { id } });
    if (!subjectType) throw new NotFoundException('Subject type not found');

    if (subjectType.is_active === active) return subjectType;

    subjectType.is_active = active;
    return this.subjectTypes.save(subjectType);
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
      const qb = this.subjectTypes
        .createQueryBuilder('st')
        .where(`LOWER(st.${c.field}) = LOWER(:v)`, { v: c.value });
      if (opts.excludeId) qb.andWhere('st.id != :id', { id: opts.excludeId });
      const collision = await qb.getOne();
      if (collision) throw new ConflictException(c.message);
    }
  }
}
