import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CountriesSortField } from '../dto/list-countries.dto';
import { Country } from '../entities/country.entity';

export interface ListCountriesResult {
  rows: Country[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<CountriesSortField, string> = {
  name: 'name',
  iso2: 'iso2',
  iso3: 'iso3',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

interface CreateCountryInput {
  name: string;
  iso2?: string | null;
  iso3?: string | null;
  dial_code?: string | null;
}

interface UpdateCountryInput {
  name?: string;
  iso2?: string | null;
  iso3?: string | null;
  dial_code?: string | null;
}

@Injectable()
export class CountriesService {
  constructor(
    @InjectRepository(Country)
    private readonly countries: Repository<Country>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: CountriesSortField;
    sortOrder: 'asc' | 'desc';
    nameSearch?: string;
    iso2Search?: string;
    status?: 'active' | 'inactive';
  }): Promise<ListCountriesResult> {
    const qb = this.countries.createQueryBuilder('c');

    if (opts.nameSearch) {
      qb.andWhere('LOWER(c.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.iso2Search) {
      qb.andWhere('LOWER(c.iso2) LIKE :i2', {
        i2: `%${opts.iso2Search.toLowerCase()}%`,
      });
    }

    if (opts.status === 'active') {
      qb.andWhere('c.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('c.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`c.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('c.id', 'ASC')
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

  async getOne(id: number): Promise<Country> {
    const row = await this.countries.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Country not found');
    return row;
  }

  async create(input: CreateCountryInput): Promise<Country> {
    await this.assertUnique({
      name: input.name,
      iso2: input.iso2 ?? undefined,
      iso3: input.iso3 ?? undefined,
    });

    const row = this.countries.create({
      name: input.name,
      iso2: input.iso2 ?? null,
      iso3: input.iso3 ?? null,
      dial_code: input.dial_code ?? null,
      is_active: true,
    });
    return this.countries.save(row);
  }

  async update(id: number, patch: UpdateCountryInput): Promise<Country> {
    const row = await this.countries.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Country not found');

    await this.assertUnique({
      name:
        patch.name !== undefined && patch.name !== row.name
          ? patch.name
          : undefined,
      // Only re-check a code when it is changing to a non-null value; clearing
      // it to null can never collide (NULL is exempt from UNIQUE in Postgres).
      iso2:
        patch.iso2 !== undefined &&
        patch.iso2 !== null &&
        patch.iso2 !== row.iso2
          ? patch.iso2
          : undefined,
      iso3:
        patch.iso3 !== undefined &&
        patch.iso3 !== null &&
        patch.iso3 !== row.iso3
          ? patch.iso3
          : undefined,
      excludeId: id,
    });

    // `!== undefined` (not `!= null`): an explicit null clears the column,
    // while an absent key leaves it untouched.
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.iso2 !== undefined) row.iso2 = patch.iso2;
    if (patch.iso3 !== undefined) row.iso3 = patch.iso3;
    if (patch.dial_code !== undefined) row.dial_code = patch.dial_code;

    return this.countries.save(row);
  }

  async setActive(id: number, active: boolean): Promise<Country> {
    const row = await this.countries.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Country not found');

    if (row.is_active === active) return row;

    // Deliberately does not cascade to states/districts — see Country.is_active.
    row.is_active = active;
    return this.countries.save(row);
  }

  private async assertUnique(opts: {
    name?: string;
    iso2?: string;
    iso3?: string;
    excludeId?: number;
  }): Promise<void> {
    const checks: Array<[keyof Country & string, string | undefined, string]> =
      [
        ['name', opts.name, 'Name is already in use'],
        ['iso2', opts.iso2, 'ISO alpha-2 code is already in use'],
        ['iso3', opts.iso3, 'ISO alpha-3 code is already in use'],
      ];

    for (const [column, value, message] of checks) {
      if (value === undefined) continue;
      const qb = this.countries
        .createQueryBuilder('c')
        .where(`LOWER(c.${column}) = LOWER(:v)`, { v: value });
      if (opts.excludeId !== undefined) {
        qb.andWhere('c.id != :id', { id: opts.excludeId });
      }
      if (await qb.getOne()) throw new ConflictException(message);
    }
  }
}
