import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LookupDto, UpdateLookupDto } from './dto/attribute.dto';
import {
  COMPANY_LOOKUP_KINDS,
  CompanyCategory,
  CompanyCurrentStatus,
  CompanyLookupBase,
  CompanyLookupKind,
  CompanyRelationshipType,
} from './entities/company-lookups.entity';

/** The one kind that carries a default. Kept here so the check is greppable. */
const DEFAULTABLE_KIND: CompanyLookupKind = 'current-statuses';

/**
 * CRUD over the configurable company-classifier lookups. The `kind` URL segment
 * is validated against an explicit whitelist → repository map so the
 * parameterised endpoint stays greppable (no dynamic entity resolution), and so
 * another kind is one map entry away.
 */
@Injectable()
export class CompanyAttributesService {
  private readonly repos: Record<
    CompanyLookupKind,
    Repository<CompanyLookupBase>
  >;

  constructor(
    @InjectRepository(CompanyCategory)
    categories: Repository<CompanyCategory>,
    @InjectRepository(CompanyRelationshipType)
    relationshipTypes: Repository<CompanyRelationshipType>,
    // Held typed as well as in the map: the default marker is this kind's alone,
    // and the generic `Repository<CompanyLookupBase>` cannot see `is_default`.
    @InjectRepository(CompanyCurrentStatus)
    private readonly statuses: Repository<CompanyCurrentStatus>,
  ) {
    this.repos = {
      categories,
      'relationship-types': relationshipTypes,
      'current-statuses': statuses,
    };
  }

  private repo(kind: string): Repository<CompanyLookupBase> {
    if (!(COMPANY_LOOKUP_KINDS as readonly string[]).includes(kind)) {
      throw new NotFoundException(`Unknown attribute type "${kind}".`);
    }
    return this.repos[kind as CompanyLookupKind];
  }

  list(kind: string, includeInactive = false): Promise<CompanyLookupBase[]> {
    const repo = this.repo(kind);
    return repo.find({
      where: includeInactive ? {} : { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  /** All active lookups, keyed by kind — feeds the company form's pickers. */
  async activeByKind(): Promise<
    Record<CompanyLookupKind, CompanyLookupBase[]>
  > {
    const out = {} as Record<CompanyLookupKind, CompanyLookupBase[]>;
    for (const kind of COMPANY_LOOKUP_KINDS) {
      out[kind] = await this.repos[kind].find({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      });
    }
    return out;
  }

  async create(kind: string, dto: LookupDto): Promise<CompanyLookupBase> {
    const repo = this.repo(kind);
    const exists = await repo.findOne({ where: { name: dto.name } });
    if (exists) {
      throw new BadRequestException(`"${dto.name}" already exists.`);
    }
    const row = repo.create({
      name: dto.name,
      // Append rather than land at 0. These lists are ordered deliberately —
      // a new current status at 0 would sort into the middle of the seeded
      // block, since the list order is (sort_order, name).
      sort_order: dto.sort_order ?? (await this.nextSortOrder(repo)),
    });
    return repo.save(row);
  }

  async update(
    kind: string,
    id: number,
    dto: UpdateLookupDto,
  ): Promise<CompanyLookupBase> {
    const repo = this.repo(kind);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attribute not found.');
    if (dto.name !== undefined && dto.name !== row.name) {
      const clash = await repo.findOne({ where: { name: dto.name } });
      if (clash) throw new BadRequestException(`"${dto.name}" already exists.`);
      row.name = dto.name;
    }
    if (dto.sort_order !== undefined) row.sort_order = dto.sort_order;
    return repo.save(row);
  }

  async setStatus(
    kind: string,
    id: number,
    isActive: boolean,
  ): Promise<CompanyLookupBase> {
    const repo = this.repo(kind);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attribute not found.');
    // Deactivating the default would leave CR View rendering a status nobody
    // can pick — the pickers only offer active values.
    if (
      !isActive &&
      kind === DEFAULTABLE_KIND &&
      (row as CompanyCurrentStatus).is_default
    ) {
      throw new BadRequestException(
        'Make another status the default before deactivating this one.',
      );
    }
    row.is_active = isActive;
    return repo.save(row);
  }

  /**
   * Move the "default" marker onto one current status.
   *
   * Exclusive by construction: the clear and the set happen in ONE transaction,
   * so the partial unique index is never asked to hold two TRUEs — the same
   * choreography `AddDefaultTimetableFlag` documents for timetables.
   *
   * There is no unset. CR View renders the default for every (role, year) with
   * nothing recorded, so one has to exist; moving it is the only legal edit.
   */
  async setDefault(kind: string, id: number): Promise<CompanyLookupBase> {
    // Runs the whitelist check first so an unknown kind still 404s.
    this.repo(kind);
    if (kind !== DEFAULTABLE_KIND) {
      throw new BadRequestException('This attribute type has no default.');
    }
    const row = await this.statuses.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attribute not found.');
    if (!row.is_active) {
      throw new BadRequestException(
        'Activate this status before making it the default.',
      );
    }
    return this.statuses.manager.transaction(async (m) => {
      await m.update(
        CompanyCurrentStatus,
        { is_default: true },
        { is_default: false },
      );
      row.is_default = true;
      return m.save(row);
    });
  }

  /** `max(sort_order) + 1`, or 0 for an empty list. */
  private async nextSortOrder(
    repo: Repository<CompanyLookupBase>,
  ): Promise<number> {
    const [top] = await repo.find({
      order: { sort_order: 'DESC' },
      take: 1,
    });
    return top ? top.sort_order + 1 : 0;
  }
}
