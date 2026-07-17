import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AdmissionYearsSortField } from '../dto/list-admission-years.dto';
import { AdmissionYear } from '../entities/admission-year.entity';

export interface ListAdmissionYearsResult {
  rows: AdmissionYear[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<AdmissionYearsSortField, string> = {
  year: 'year',
  display_year: 'display_year',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateAdmissionYearInput {
  year: number;
  display_year: string;
}

interface UpdateAdmissionYearInput {
  year?: number;
  display_year?: string;
}

@Injectable()
export class AdmissionYearsService {
  constructor(
    @InjectRepository(AdmissionYear)
    private readonly years: Repository<AdmissionYear>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: AdmissionYearsSortField;
    sortOrder: 'asc' | 'desc';
    yearSearch?: string;
    displayYearSearch?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListAdmissionYearsResult> {
    const qb = this.years.createQueryBuilder('y');

    if (opts.yearSearch) {
      qb.andWhere('CAST(y.year AS TEXT) LIKE :yn', {
        yn: `%${opts.yearSearch}%`,
      });
    }

    if (opts.displayYearSearch) {
      qb.andWhere('LOWER(y.display_year) LIKE :dn', {
        dn: `%${opts.displayYearSearch.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('y.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('y.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`y.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('y.id', 'ASC')
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

  async getOne(id: number): Promise<AdmissionYear> {
    const row = await this.years.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Admission year not found');
    return row;
  }

  async create(input: CreateAdmissionYearInput): Promise<AdmissionYear> {
    await this.assertYearUnique(input.year);

    const row = this.years.create({
      year: input.year,
      display_year: input.display_year,
      is_active: true,
    });
    return this.years.save(row);
  }

  async update(
    id: number,
    patch: UpdateAdmissionYearInput,
  ): Promise<AdmissionYear> {
    const row = await this.years.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Admission year not found');

    if (patch.year !== undefined && patch.year !== row.year) {
      await this.assertYearUnique(patch.year, id);
      row.year = patch.year;
    }
    if (patch.display_year !== undefined) row.display_year = patch.display_year;

    return this.years.save(row);
  }

  async setActive(id: number, active: boolean): Promise<AdmissionYear> {
    const row = await this.years.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Admission year not found');

    if (row.is_active === active) return row;

    row.is_active = active;
    return this.years.save(row);
  }

  private async assertYearUnique(
    year: number,
    excludeId?: number,
  ): Promise<void> {
    const qb = this.years
      .createQueryBuilder('y')
      .where('y.year = :year', { year });
    if (excludeId !== undefined) qb.andWhere('y.id != :id', { id: excludeId });
    const collision = await qb.getOne();
    if (collision) throw new ConflictException('Year is already in use');
  }
}
