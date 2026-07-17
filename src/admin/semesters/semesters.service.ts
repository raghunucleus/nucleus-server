import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SemestersSortField } from '../dto/list-semesters.dto';
import { Semester } from '../entities/semester.entity';

export interface ListSemestersResult {
  rows: Semester[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<SemestersSortField, string> = {
  sem_number: 'sem_number',
  code: 'code',
  name: 'name',
  year_sem_format: 'year_sem_format',
  roman_format: 'roman_format',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateSemesterInput {
  sem_number: number;
  code: string;
  name: string;
  year_sem_format: string;
  roman_format: string;
}

interface UpdateSemesterInput {
  sem_number?: number;
  code?: string;
  name?: string;
  year_sem_format?: string;
  roman_format?: string;
}

@Injectable()
export class SemestersService {
  constructor(
    @InjectRepository(Semester)
    private readonly semesters: Repository<Semester>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: SemestersSortField;
    sortOrder: 'asc' | 'desc';
    semNumberSearch?: string;
    codeSearch?: string;
    nameSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListSemestersResult> {
    const qb = this.semesters.createQueryBuilder('s');

    if (opts.semNumberSearch) {
      qb.andWhere('CAST(s.sem_number AS TEXT) LIKE :sn', {
        sn: `%${opts.semNumberSearch}%`,
      });
    }

    if (opts.codeSearch) {
      qb.andWhere('LOWER(s.code) LIKE :cn', {
        cn: `%${opts.codeSearch.toLowerCase()}%`,
      });
    }

    if (opts.nameSearch) {
      qb.andWhere('LOWER(s.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('s.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('s.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`s.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('s.id', 'ASC')
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

  async getOne(id: number): Promise<Semester> {
    const row = await this.semesters.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Semester not found');
    return row;
  }

  async create(input: CreateSemesterInput): Promise<Semester> {
    await this.assertUnique({
      sem_number: input.sem_number,
      code: input.code,
    });

    const row = this.semesters.create({
      sem_number: input.sem_number,
      code: input.code,
      name: input.name,
      year_sem_format: input.year_sem_format,
      roman_format: input.roman_format,
      is_active: true,
    });
    return this.semesters.save(row);
  }

  async update(id: number, patch: UpdateSemesterInput): Promise<Semester> {
    const row = await this.semesters.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Semester not found');

    await this.assertUnique({
      sem_number:
        patch.sem_number !== undefined && patch.sem_number !== row.sem_number
          ? patch.sem_number
          : undefined,
      code:
        patch.code !== undefined && patch.code !== row.code
          ? patch.code
          : undefined,
      excludeId: id,
    });

    if (patch.sem_number !== undefined) row.sem_number = patch.sem_number;
    if (patch.code !== undefined) row.code = patch.code;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.year_sem_format !== undefined)
      row.year_sem_format = patch.year_sem_format;
    if (patch.roman_format !== undefined) row.roman_format = patch.roman_format;

    return this.semesters.save(row);
  }

  async setActive(id: number, active: boolean): Promise<Semester> {
    const row = await this.semesters.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Semester not found');

    if (row.is_active === active) return row;

    row.is_active = active;
    return this.semesters.save(row);
  }

  private async assertUnique(opts: {
    sem_number?: number;
    code?: string;
    excludeId?: number;
  }): Promise<void> {
    if (opts.sem_number !== undefined) {
      const qb = this.semesters
        .createQueryBuilder('s')
        .where('s.sem_number = :v', { v: opts.sem_number });
      if (opts.excludeId !== undefined)
        qb.andWhere('s.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Sem number is already in use');
    }
    if (opts.code !== undefined) {
      const qb = this.semesters
        .createQueryBuilder('s')
        .where('LOWER(s.code) = LOWER(:v)', { v: opts.code });
      if (opts.excludeId !== undefined)
        qb.andWhere('s.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Code is already in use');
    }
  }
}
