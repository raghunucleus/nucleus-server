import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import type { DistrictsSortField } from '../dto/list-districts.dto';
import { District } from '../entities/district.entity';
import { State } from '../entities/state.entity';

export interface ListDistrictsResult {
  rows: District[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// 'state' / 'country' sort on joined names, not columns of `districts`.
const SORT_COLUMN: Record<DistrictsSortField, string> = {
  name: 'd.name',
  lgd_code: 'd.lgd_code',
  state: 's.name',
  country: 'c.name',
  status: 'd.is_active',
  created_at: 'd.created_at',
  updated_at: 'd.updated_at',
};

interface CreateDistrictInput {
  state_id: number;
  name: string;
  lgd_code?: string | null;
}

interface UpdateDistrictInput {
  state_id?: number;
  name?: string;
  lgd_code?: string | null;
}

@Injectable()
export class DistrictsService {
  constructor(
    @InjectRepository(District)
    private readonly districts: Repository<District>,
    @InjectRepository(State)
    private readonly states: Repository<State>,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: DistrictsSortField;
    sortOrder: 'asc' | 'desc';
    countryId?: number;
    stateId?: number;
    nameSearch?: string;
    lgdCodeSearch?: string;
    status?: 'active' | 'inactive';
    effectiveActive?: boolean;
  }): Promise<ListDistrictsResult> {
    // Eager relations do not apply to createQueryBuilder, so both levels of the
    // chain are joined explicitly. Needed anyway for countryId filtering,
    // parent-name sorting and the effectiveActive chain. These are ManyToOne,
    // so the joins cannot multiply rows and pagination stays correct.
    const qb = this.districts
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.state', 's')
      .leftJoinAndSelect('s.country', 'c');

    if (opts.stateId !== undefined) {
      qb.andWhere('d.state_id = :sid', { sid: opts.stateId });
    }

    if (opts.countryId !== undefined) {
      qb.andWhere('s.country_id = :cid', { cid: opts.countryId });
    }

    if (opts.nameSearch) {
      qb.andWhere('LOWER(d.name) LIKE :nn', {
        nn: `%${opts.nameSearch.toLowerCase()}%`,
      });
    }

    if (opts.lgdCodeSearch) {
      qb.andWhere('LOWER(d.lgd_code) LIKE :lc', {
        lc: `%${opts.lgdCodeSearch.toLowerCase()}%`,
      });
    }

    // effectiveActive wins over status when both are sent — see ListDistrictsDto.
    if (opts.effectiveActive !== undefined) {
      this.applyEffectiveActive(qb, opts.effectiveActive);
    } else if (opts.status === 'active') {
      qb.andWhere('d.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('d.is_active = FALSE');
    }

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(SORT_COLUMN[opts.sortBy], direction, 'NULLS LAST')
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

  // The single place the full ancestor-chain rule is expressed.
  //
  // is_active is independent per level by design: deactivating a state leaves
  // its districts' own flags alone. That means d.is_active does NOT mean
  // "usable" — an active district can sit under an inactive state or country.
  //
  // Every consumer that offers districts for downstream selection must filter
  // through here, via `GET /admin/districts?effectiveActive=true`. Do not
  // hand-roll `WHERE d.is_active` at a call site; it will silently leak
  // districts of deactivated states.
  //
  // The management screens deliberately do NOT use this — they filter on
  // `status` (the row's own flag) so an admin can still find and fix a district
  // whose parent is switched off.
  //
  // Requires the 's' and 'c' joins to be present on `qb`.
  private applyEffectiveActive(
    qb: SelectQueryBuilder<District>,
    active: boolean,
  ): void {
    const chain =
      'd.is_active = TRUE AND s.is_active = TRUE AND c.is_active = TRUE';
    qb.andWhere(active ? `(${chain})` : `NOT (${chain})`);
  }

  async getOne(id: number): Promise<District> {
    // findOne, so the eager state -> country chain is hydrated.
    const row = await this.districts.findOne({ where: { id } });
    if (!row) throw new NotFoundException('District not found');
    return row;
  }

  async create(input: CreateDistrictInput): Promise<District> {
    await this.assertStateExists(input.state_id);
    await this.assertUnique({
      state_id: input.state_id,
      name: input.name,
      lgd_code: input.lgd_code ?? undefined,
    });

    const row = this.districts.create({
      state_id: input.state_id,
      name: input.name,
      lgd_code: input.lgd_code ?? null,
      is_active: true,
    });
    const saved = await this.districts.save(row);
    // save() returns the entity without eager relations hydrated, so re-read it
    // — otherwise the caller gets a District with `state` undefined and the UI
    // blanks its State/Country columns.
    return this.getOne(saved.id);
  }

  async update(id: number, patch: UpdateDistrictInput): Promise<District> {
    // loadEagerRelations: false is load-bearing, not an optimisation. With the
    // eager `state` hydrated, save() takes the FK from the loaded relation
    // OBJECT rather than the state_id column — so re-parenting by assigning
    // row.state_id would silently not stick. Reading the bare row avoids that;
    // getOne() re-reads with relations at the end anyway.
    const row = await this.districts.findOne({
      where: { id },
      loadEagerRelations: false,
    });
    if (!row) throw new NotFoundException('District not found');

    if (patch.state_id !== undefined && patch.state_id !== row.state_id) {
      await this.assertStateExists(patch.state_id);
    }

    // UQ_districts_state_id_name is composite — same reasoning as
    // StatesService.update: check the EFFECTIVE parent, and fire whenever
    // either half moves, or re-parenting into a state that already has this
    // name returns a 500 instead of a 409.
    const effectiveStateId = patch.state_id ?? row.state_id;
    const effectiveName = patch.name ?? row.name;
    const pairMoved =
      (patch.name !== undefined && patch.name !== row.name) ||
      (patch.state_id !== undefined && patch.state_id !== row.state_id);

    await this.assertUnique({
      state_id: effectiveStateId,
      name: pairMoved ? effectiveName : undefined,
      lgd_code:
        patch.lgd_code !== undefined &&
        patch.lgd_code !== null &&
        patch.lgd_code !== row.lgd_code
          ? patch.lgd_code
          : undefined,
      excludeId: id,
    });

    // `!== undefined` (not `!= null`): an explicit null clears the column,
    // while an absent key leaves it untouched.
    if (patch.state_id !== undefined) row.state_id = patch.state_id;
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.lgd_code !== undefined) row.lgd_code = patch.lgd_code;

    const saved = await this.districts.save(row);
    return this.getOne(saved.id);
  }

  async setActive(id: number, active: boolean): Promise<District> {
    const row = await this.districts.findOne({
      where: { id },
      loadEagerRelations: false,
    });
    if (!row) throw new NotFoundException('District not found');

    if (row.is_active === active) return this.getOne(id);

    row.is_active = active;
    const saved = await this.districts.save(row);
    return this.getOne(saved.id);
  }

  // Attaching to an INACTIVE state is allowed: is_active is independent per
  // level, and effectiveActive already hides such rows from consumers. We only
  // require that the parent exists.
  private async assertStateExists(stateId: number): Promise<void> {
    const exists = await this.states.exist({ where: { id: stateId } });
    if (!exists) throw new NotFoundException('State not found');
  }

  private async assertUnique(opts: {
    state_id: number;
    name?: string;
    lgd_code?: string;
    excludeId?: number;
  }): Promise<void> {
    if (opts.name !== undefined) {
      const qb = this.districts
        .createQueryBuilder('d')
        .where('d.state_id = :sid', { sid: opts.state_id })
        .andWhere('LOWER(d.name) = LOWER(:v)', { v: opts.name });
      if (opts.excludeId !== undefined) {
        qb.andWhere('d.id != :id', { id: opts.excludeId });
      }
      if (await qb.getOne()) {
        throw new ConflictException(
          'A district with this name already exists in this state',
        );
      }
    }

    // LGD district codes are unique nationally, so this check is global rather
    // than scoped to the state.
    if (opts.lgd_code !== undefined) {
      const qb = this.districts
        .createQueryBuilder('d')
        .where('LOWER(d.lgd_code) = LOWER(:v)', { v: opts.lgd_code });
      if (opts.excludeId !== undefined) {
        qb.andWhere('d.id != :id', { id: opts.excludeId });
      }
      if (await qb.getOne()) {
        throw new ConflictException('LGD code is already in use');
      }
    }
  }
}
