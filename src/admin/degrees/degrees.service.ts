import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DegreesSortField } from '../dto/list-degrees.dto';
import { Degree } from '../entities/degree.entity';

export interface ListDegreesResult {
  rows: Degree[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<DegreesSortField, string> = {
  name: 'name',
  code: 'code',
  short_name: 'short_name',
  academic_level: 'academic_level',
  duration_years: 'duration_years',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateDegreeInput {
  name: string;
  code: string;
  short_name: string;
  academic_level: string;
  duration_years: number;
}

interface UpdateDegreeInput {
  name?: string;
  code?: string;
  short_name?: string;
  academic_level?: string;
  duration_years?: number;
}

@Injectable()
export class DegreesService {
  constructor(
    @InjectRepository(Degree) private readonly degrees: Repository<Degree>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: DegreesSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    codeSearch?: string;
    shortNameSearch?: string;
    status?: 'active' | 'inactive';
    academicLevel?: string;
  }): Promise<ListDegreesResult> {
    const qb = this.degrees.createQueryBuilder('d');

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

    if (opts.academicLevel) {
      qb.andWhere('d.academic_level = :al', { al: opts.academicLevel });
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

  async getOne(id: number): Promise<Degree> {
    const degree = await this.degrees.findOne({ where: { id } });
    if (!degree) throw new NotFoundException('Degree not found');
    return degree;
  }

  async create(input: CreateDegreeInput): Promise<Degree> {
    await this.assertUnique({
      name: input.name,
      code: input.code,
      short_name: input.short_name,
    });

    const degree = this.degrees.create({
      name: input.name,
      code: input.code,
      short_name: input.short_name,
      academic_level: input.academic_level,
      duration_years: input.duration_years,
      is_active: true,
    });
    return this.degrees.save(degree);
  }

  async update(id: number, patch: UpdateDegreeInput): Promise<Degree> {
    const degree = await this.degrees.findOne({ where: { id } });
    if (!degree) throw new NotFoundException('Degree not found');

    await this.assertUnique({
      name:
        patch.name !== undefined && patch.name !== degree.name
          ? patch.name
          : undefined,
      code:
        patch.code !== undefined && patch.code !== degree.code
          ? patch.code
          : undefined,
      short_name:
        patch.short_name !== undefined && patch.short_name !== degree.short_name
          ? patch.short_name
          : undefined,
      excludeId: id,
    });

    const durationChanged =
      patch.duration_years !== undefined &&
      patch.duration_years !== degree.duration_years;

    if (patch.name !== undefined) degree.name = patch.name;
    if (patch.code !== undefined) degree.code = patch.code;
    if (patch.short_name !== undefined) degree.short_name = patch.short_name;
    if (patch.academic_level !== undefined)
      degree.academic_level = patch.academic_level;
    if (patch.duration_years !== undefined)
      degree.duration_years = patch.duration_years;

    const saved = await this.degrees.save(degree);

    // Keep the cached students.pass_out_year honest: it is admission year +
    // THIS duration, so a duration change re-derives it for every student in
    // every programme of this degree, in one statement.
    if (durationChanged) {
      await this.degrees.manager.query(
        `UPDATE "students" s
         SET "pass_out_year" = ay."year" + $2
         FROM "programmes" p, "admission_years" ay
         WHERE p."id" = s."programme_id"
           AND ay."id" = s."admission_year_id"
           AND p."degree_id" = $1`,
        [id, saved.duration_years],
      );
    }

    return saved;
  }

  async setActive(id: number, active: boolean): Promise<Degree> {
    const degree = await this.degrees.findOne({ where: { id } });
    if (!degree) throw new NotFoundException('Degree not found');

    if (degree.is_active === active) return degree;

    degree.is_active = active;
    return this.degrees.save(degree);
  }

  private async assertUnique(opts: {
    name?: string;
    code?: string;
    short_name?: string;
    excludeId?: number;
  }): Promise<void> {
    const checks: {
      field: 'name' | 'code' | 'short_name';
      value: string;
      message: string;
    }[] = [];
    if (opts.name !== undefined)
      checks.push({
        field: 'name',
        value: opts.name,
        message: 'Name is already in use',
      });
    if (opts.code !== undefined)
      checks.push({
        field: 'code',
        value: opts.code,
        message: 'Code is already in use',
      });
    if (opts.short_name !== undefined)
      checks.push({
        field: 'short_name',
        value: opts.short_name,
        message: 'Short name is already in use',
      });

    for (const c of checks) {
      const qb = this.degrees
        .createQueryBuilder('d')
        .where(`LOWER(d.${c.field}) = LOWER(:v)`, { v: c.value });
      if (opts.excludeId) qb.andWhere('d.id != :id', { id: opts.excludeId });
      const collision = await qb.getOne();
      if (collision) throw new ConflictException(c.message);
    }
  }
}
