import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriveLookupDto, UpdateDriveLookupDto } from './dto/attribute.dto';
import {
  DRIVE_LOOKUP_KINDS,
  DriveDesignation,
  DriveJobLocation,
  DriveLookupBase,
  DriveLookupKind,
  DriveOfferType,
  DrivePlacementCategory,
} from './entities/drive-lookups.entity';

const NO_FLAGS =
  'An offer type must be an internship, a full-time role, or both.';
const NO_BOUNDS =
  'A placement category needs a minimum salary, a maximum salary, or both.';
const BAD_RANGE = 'The minimum salary must be less than the maximum.';

/** Postgres hands back `numeric` as a string; the bounds compare as numbers. */
function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}

/**
 * CRUD over the configurable drive-classifier lookups. The `kind` URL segment
 * is validated against an explicit whitelist → repository map so the
 * parameterised endpoint stays greppable (no dynamic entity resolution).
 */
@Injectable()
export class DriveAttributesService {
  private readonly repos: Record<DriveLookupKind, Repository<DriveLookupBase>>;

  constructor(
    @InjectRepository(DriveDesignation)
    designations: Repository<DriveDesignation>,
    @InjectRepository(DriveJobLocation)
    jobLocations: Repository<DriveJobLocation>,
    @InjectRepository(DriveOfferType)
    private readonly offerTypes: Repository<DriveOfferType>,
    @InjectRepository(DrivePlacementCategory)
    private readonly placementCategories: Repository<DrivePlacementCategory>,
  ) {
    this.repos = {
      designations,
      'job-locations': jobLocations,
      'offer-types': offerTypes,
      'placement-categories': placementCategories,
    };
  }

  /**
   * Validate a placement category's merged bounds and render them for storage.
   * Shared by create and update so both reject the same shapes.
   */
  private bounds(
    min: number | null,
    max: number | null,
  ): { min_lpa: string | null; max_lpa: string | null } {
    if (min === null && max === null) throw new BadRequestException(NO_BOUNDS);
    if (min !== null && max !== null && min >= max) {
      throw new BadRequestException(BAD_RANGE);
    }
    return {
      min_lpa: min === null ? null : String(min),
      max_lpa: max === null ? null : String(max),
    };
  }

  private repo(kind: string): Repository<DriveLookupBase> {
    if (!(DRIVE_LOOKUP_KINDS as readonly string[]).includes(kind)) {
      throw new NotFoundException(`Unknown attribute type "${kind}".`);
    }
    return this.repos[kind as DriveLookupKind];
  }

  list(kind: string, includeInactive = false): Promise<DriveLookupBase[]> {
    const repo = this.repo(kind);
    return repo.find({
      where: includeInactive ? {} : { is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
  }

  async create(kind: string, dto: DriveLookupDto): Promise<DriveLookupBase> {
    const repo = this.repo(kind);
    const exists = await repo.findOne({ where: { name: dto.name } });
    if (exists) {
      throw new BadRequestException(`"${dto.name}" already exists.`);
    }

    if (kind === 'offer-types') {
      const is_internship = dto.is_internship ?? false;
      const is_full_time = dto.is_full_time ?? false;
      if (!is_internship && !is_full_time) {
        throw new BadRequestException(NO_FLAGS);
      }
      return this.offerTypes.save(
        this.offerTypes.create({
          name: dto.name,
          sort_order: dto.sort_order ?? 0,
          is_internship,
          is_full_time,
        }),
      );
    }

    if (kind === 'placement-categories') {
      return this.placementCategories.save(
        this.placementCategories.create({
          name: dto.name,
          sort_order: dto.sort_order ?? 0,
          ...this.bounds(dto.min_lpa ?? null, dto.max_lpa ?? null),
        }),
      );
    }

    // The kind-specific fields are meaningless for the other kinds — drop them
    // rather than persist a field the table doesn't have.
    const row = repo.create({
      name: dto.name,
      sort_order: dto.sort_order ?? 0,
    });
    return repo.save(row);
  }

  async update(
    kind: string,
    id: number,
    dto: UpdateDriveLookupDto,
  ): Promise<DriveLookupBase> {
    const repo = this.repo(kind);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attribute not found.');
    if (dto.name !== undefined && dto.name !== row.name) {
      const clash = await repo.findOne({ where: { name: dto.name } });
      if (clash) throw new BadRequestException(`"${dto.name}" already exists.`);
      row.name = dto.name;
    }
    if (dto.sort_order !== undefined) row.sort_order = dto.sort_order;

    if (kind === 'offer-types') {
      const offer = row as DriveOfferType;
      // Check the merged result, not the patch alone: clearing the only set
      // flag has to fail even when the request names just that one field.
      const is_internship = dto.is_internship ?? offer.is_internship;
      const is_full_time = dto.is_full_time ?? offer.is_full_time;
      if (!is_internship && !is_full_time) {
        throw new BadRequestException(NO_FLAGS);
      }
      offer.is_internship = is_internship;
      offer.is_full_time = is_full_time;
    }

    if (kind === 'placement-categories') {
      const cat = row as DrivePlacementCategory;
      // `!== undefined`, not `??`: null is a real value here (an open-ended
      // bound), so `??` would fall through to the stored bound and silently
      // drop a client clearing it.
      const min = dto.min_lpa !== undefined ? dto.min_lpa : num(cat.min_lpa);
      const max = dto.max_lpa !== undefined ? dto.max_lpa : num(cat.max_lpa);
      Object.assign(cat, this.bounds(min, max));
    }

    return repo.save(row);
  }

  async setStatus(
    kind: string,
    id: number,
    isActive: boolean,
  ): Promise<DriveLookupBase> {
    const repo = this.repo(kind);
    const row = await repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Attribute not found.');
    row.is_active = isActive;
    return repo.save(row);
  }
}
