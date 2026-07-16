import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import type { StatesSortField } from '../dto/list-states.dto';
import { Country } from '../entities/country.entity';
import { State } from '../entities/state.entity';

export interface ListStatesResult {
  rows: State[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// 'country' sorts on the joined country name, not a column of `states`.
const SORT_COLUMN: Record<StatesSortField, string> = {
  name: 's.name',
  lgd_code: 's.lgd_code',
  iso_code: 's.iso_code',
  country: 'c.name',
  status: 's.is_active',
  created_at: 's.created_at',
  updated_at: 's.updated_at',
};

interface CreateStateInput {
  country_id: number;
  name: string;
  lgd_code?: string | null;
  iso_code?: string | null;
}

interface UpdateStateInput {
  country_id?: number;
  name?: string;
  lgd_code?: string | null;
  iso_code?: string | null;
}

@Injectable()
export class StatesService {
  constructor(
    @InjectRepository(State)
    private readonly states: Repository<State>,
    @InjectRepository(Country)
    private readonly countries: Repository<Country>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: StatesSortField;
    sortOrder: 'asc' | 'desc';
    countryId?: number;
    nameSearch?: string;
    lgdCodeSearch?: string;
    isoCodeSearch?: string;
    status?: 'active' | 'inactive';
    effectiveActive?: boolean;
  }): Promise<ListStatesResult> {
    // The `country` relation is eager, but eager only applies to find*, never
    // to createQueryBuilder — so the join is explicit. It is needed anyway for
    // countryId filtering, country-name sorting and the effectiveActive chain.
    const qb = this.states
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.country', 'c');

    if (opts.countryId !== undefined) {
      qb.andWhere('s.country_id = :cid', { cid: opts.countryId });
    }

    if (opts.nameSearch) {
      qb.andWhere('LOWER(s.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.lgdCodeSearch) {
      qb.andWhere('LOWER(s.lgd_code) LIKE :lc', {
        lc: `%${opts.lgdCodeSearch.toLowerCase()}%`,
      });
    }

    if (opts.isoCodeSearch) {
      qb.andWhere('LOWER(s.iso_code) LIKE :ic', {
        ic: `%${opts.isoCodeSearch.toLowerCase()}%`,
      });
    }

    // effectiveActive wins over status when both are sent — see ListStatesDto.
    if (opts.effectiveActive !== undefined) {
      this.applyEffectiveActive(qb, opts.effectiveActive);
    } else if (opts.status === 'active') {
      qb.andWhere('s.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('s.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(SORT_COLUMN[opts.sortBy], direction, 'NULLS LAST')
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

  // The single place the state-level ancestor-chain rule is expressed.
  //
  // is_active is independent per level, so a state's own flag does NOT mean
  // "usable" — an active state can sit under a deactivated country. Anything
  // offering states for downstream selection must go through here (via the
  // `effectiveActive` list param) rather than filtering s.is_active itself.
  //
  // Requires the 'c' join to be present on `qb`.
  private applyEffectiveActive(
    qb: SelectQueryBuilder<State>,
    active: boolean,
  ): void {
    const chain = 's.is_active = TRUE AND c.is_active = TRUE';
    qb.andWhere(active ? `(${chain})` : `NOT (${chain})`);
  }

  async getOne(id: number): Promise<State> {
    // findOne, so the eager country (and nothing deeper) is hydrated.
    const row = await this.states.findOne({ where: { id } });
    if (!row) throw new NotFoundException('State not found');
    return row;
  }

  async create(input: CreateStateInput): Promise<State> {
    await this.assertCountryExists(input.country_id);
    await this.assertUnique({
      country_id: input.country_id,
      name: input.name,
      lgd_code: input.lgd_code ?? undefined,
      iso_code: input.iso_code ?? undefined,
    });

    const row = this.states.create({
      country_id: input.country_id,
      name: input.name,
      lgd_code: input.lgd_code ?? null,
      iso_code: input.iso_code ?? null,
      is_active: true,
    });
    const saved = await this.states.save(row);
    // save() returns the entity without the eager relation hydrated, so re-read
    // it — otherwise the caller gets a State with `country` undefined.
    return this.getOne(saved.id);
  }

  async update(id: number, patch: UpdateStateInput): Promise<State> {
    // loadEagerRelations: false is load-bearing, not an optimisation. With the
    // eager `country` hydrated, save() takes the FK from the loaded relation
    // OBJECT rather than the country_id column — so re-parenting by assigning
    // row.country_id would silently not stick. Reading the bare row avoids
    // that; getOne() re-reads with relations at the end anyway.
    const row = await this.states.findOne({
      where: { id },
      loadEagerRelations: false,
    });
    if (!row) throw new NotFoundException('State not found');

    if (patch.country_id !== undefined && patch.country_id !== row.country_id) {
      await this.assertCountryExists(patch.country_id);
    }

    // UQ_states_country_id_name is composite, so the check must run against the
    // EFFECTIVE parent and fire whenever either half moves. Re-checking only on
    // a name change would let a state be re-parented into a country that
    // already has one by that name — surfacing as a 500 from the DB constraint
    // instead of a 409.
    const effectiveCountryId = patch.country_id ?? row.country_id;
    const effectiveName = patch.name ?? row.name;
    const pairMoved =
      (patch.name !== undefined && patch.name !== row.name) ||
      (patch.country_id !== undefined && patch.country_id !== row.country_id);

    await this.assertUnique({
      country_id: effectiveCountryId,
      name: pairMoved ? effectiveName : undefined,
      lgd_code:
        patch.lgd_code !== undefined &&
        patch.lgd_code !== null &&
        patch.lgd_code !== row.lgd_code
          ? patch.lgd_code
          : undefined,
      iso_code:
        patch.iso_code !== undefined &&
        patch.iso_code !== null &&
        patch.iso_code !== row.iso_code
          ? patch.iso_code
          : undefined,
      excludeId: id,
    });

    // `!== undefined` (not `!= null`): an explicit null clears the column,
    // while an absent key leaves it untouched.
    if (patch.country_id !== undefined) row.country_id = patch.country_id;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.lgd_code !== undefined) row.lgd_code = patch.lgd_code;
    if (patch.iso_code !== undefined) row.iso_code = patch.iso_code;

    const saved = await this.states.save(row);
    return this.getOne(saved.id);
  }

  async setActive(id: number, active: boolean): Promise<State> {
    const row = await this.states.findOne({
      where: { id },
      loadEagerRelations: false,
    });
    if (!row) throw new NotFoundException('State not found');

    if (row.is_active === active) return this.getOne(id);

    // Deliberately does not cascade to districts — see State.is_active.
    row.is_active = active;
    const saved = await this.states.save(row);
    return this.getOne(saved.id);
  }

  // Attaching to an INACTIVE country is allowed: is_active is independent per
  // level, and effectiveActive already hides such rows from consumers. We only
  // require that the parent exists.
  private async assertCountryExists(countryId: number): Promise<void> {
    const exists = await this.countries.exist({ where: { id: countryId } });
    if (!exists) throw new NotFoundException('Country not found');
  }

  private async assertUnique(opts: {
    country_id: number;
    name?: string;
    lgd_code?: string;
    iso_code?: string;
    excludeId?: number;
  }): Promise<void> {
    if (opts.name !== undefined) {
      const qb = this.states
        .createQueryBuilder('s')
        .where('s.country_id = :cid', { cid: opts.country_id })
        .andWhere('LOWER(s.name) = LOWER(:v)', { v: opts.name });
      if (opts.excludeId !== undefined) {
        qb.andWhere('s.id != :id', { id: opts.excludeId });
      }
      if (await qb.getOne()) {
        throw new ConflictException(
          'A state with this name already exists in this country',
        );
      }
    }

    const globalChecks: Array<[string, string | undefined, string]> = [
      ['lgd_code', opts.lgd_code, 'LGD code is already in use'],
      ['iso_code', opts.iso_code, 'ISO code is already in use'],
    ];

    for (const [column, value, message] of globalChecks) {
      if (value === undefined) continue;
      const qb = this.states
        .createQueryBuilder('s')
        .where(`LOWER(s.${column}) = LOWER(:v)`, { v: value });
      if (opts.excludeId !== undefined) {
        qb.andWhere('s.id != :id', { id: opts.excludeId });
      }
      if (await qb.getOne()) throw new ConflictException(message);
    }
  }
}
