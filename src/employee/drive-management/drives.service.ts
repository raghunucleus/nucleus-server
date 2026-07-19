import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { AdmissionYear } from '../../admin/entities/admission-year.entity';
import { Programme } from '../../admin/entities/programme.entity';
import { StorageService } from '../../storage/storage.service';
import { storageKey } from '../../storage/storage.constants';
import { Company } from '../corporate-relations/entities/company.entity';
import { CompanyCategory } from '../corporate-relations/entities/company-lookups.entity';
import {
  CreateDriveDto,
  DriveQueryDto,
  UpdateDriveDto,
  UpdateDriveEligibilityDto,
} from './dto/drive.dto';
import {
  Drive,
  DriveAmountMode,
  DriveFieldScope,
  DriveStatus,
} from './entities/drive.entity';
import { DriveEligibility } from './entities/drive-eligibility.entity';
import { DriveProfile } from './entities/drive-profile.entity';
import { DriveProfileAttachment } from './entities/drive-profile-attachment.entity';
import {
  DriveDesignation,
  DriveJobLocation,
  DriveOfferType,
  DrivePlacementCategory,
} from './entities/drive-lookups.entity';

/** Sortable columns → SQL, so the client never names a column directly. */
const DRIVE_SORT_COLUMN: Record<string, string> = {
  drive_name: 'd.drive_name',
  company_name: 'company.name',
  drive_date: 'd.drive_date',
  registration_end_date: 'd.registration_end_date',
  created_at: 'd.created_at',
  status: 'd.status',
};

const chip = (r: { id: number; name: string }) => ({ id: r.id, name: r.name });

/** Money arrives as a number and is stored as a string (Postgres `numeric`). */
const money = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

/** Entry-type codes → labels, matching `students.entry_type` (fixed enum). */
const ENTRY_TYPE_LABELS: Record<number, string> = { 1: 'Regular', 2: 'Lateral' };

/** Gender codes → labels, matching `students.gender` (fixed enum). */
const GENDER_LABELS: Record<string, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
};

/**
 * The shape every scoped field set has, on either a drive or a profile. Used to
 * validate + copy without caring which side it came from.
 */
interface ScopedValues {
  offer_type_id?: number | null;
  job_location_ids?: number[];
  placement_category_ids?: number[];
  has_bond?: boolean | null;
  bond_years?: number | null;
  bond_desc?: unknown;
  stipend_mode?: DriveAmountMode | null;
  stipend_min?: number | null;
  stipend_max?: number | null;
  ctc_mode?: DriveAmountMode | null;
  ctc_min?: number | null;
  ctc_max?: number | null;
}

/**
 * Drives — the placement drives a company runs on campus.
 *
 * Two rules are the reason most of this file exists, and both are invisible in
 * the schema:
 *
 *  1. **Applicability derives from the offer type's flags, never its name.**
 *     `drive_offer_types` carries `is_internship` / `is_full_time`; a stipend is
 *     only meaningful on an internship and a CTC only on a full-time role. A
 *     drive that stores a CTC against an internship-only offer type is silently
 *     wrong, so we reject it rather than persist it.
 *
 *  2. **Each scoped field lives on exactly one side.** `*_scope` says whether a
 *     value belongs to the drive or to each profile; the other side must be
 *     empty. Allowing both would leave two contradictory answers to "what is the
 *     job location?" with nothing to break the tie.
 *
 * Stipend/CTC follow `offer_type_scope` rather than carrying a switch of their
 * own — a package is meaningless without the offer type that classifies it.
 *
 * The screen has no per-attribute scope (drives are institution-wide placement
 * config), so the screen guard is the whole access check — same as the drive
 * attributes screen, and unlike the owner-scoped Companies surface.
 */
@Injectable()
export class DrivesService {
  constructor(
    @InjectRepository(Drive)
    private readonly drives: Repository<Drive>,
    @InjectRepository(DriveProfile)
    private readonly profiles: Repository<DriveProfile>,
    @InjectRepository(DriveProfileAttachment)
    private readonly attachments: Repository<DriveProfileAttachment>,
    @InjectRepository(DriveOfferType)
    private readonly offerTypes: Repository<DriveOfferType>,
    @InjectRepository(DriveJobLocation)
    private readonly jobLocations: Repository<DriveJobLocation>,
    @InjectRepository(DriveDesignation)
    private readonly designations: Repository<DriveDesignation>,
    @InjectRepository(DrivePlacementCategory)
    private readonly placementCategories: Repository<DrivePlacementCategory>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(CompanyCategory)
    private readonly companyCategories: Repository<CompanyCategory>,
    @InjectRepository(DriveEligibility)
    private readonly eligibility: Repository<DriveEligibility>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(AdmissionYear)
    private readonly admissionYears: Repository<AdmissionYear>,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  // ---- Validation ---------------------------------------------------------

  /**
   * Enforce rule 2 for one field: a value may only be present on the side its
   * scope names. Reports the field by its human name so the message says what to
   * fix rather than which column was populated.
   */
  private assertSide(
    present: boolean,
    expected: DriveFieldScope,
    actual: DriveFieldScope,
    field: string,
  ): void {
    if (present && expected !== actual) {
      const where = actual === 'drive' ? 'the drive' : 'each designation';
      const notWhere = actual === 'drive' ? 'a designation' : 'the drive';
      throw new BadRequestException(
        `${field} is set on ${notWhere}, but this drive captures it on ${where}.`,
      );
    }
  }

  /** `fixed` → only min; `range` → both, min below max. */
  private assertAmount(
    mode: DriveAmountMode | null | undefined,
    min: number | null | undefined,
    max: number | null | undefined,
    label: string,
  ): void {
    if (!mode) return;
    if (min === null || min === undefined) {
      throw new BadRequestException(`${label} needs an amount.`);
    }
    if (mode === 'fixed') {
      if (max !== null && max !== undefined) {
        throw new BadRequestException(
          `${label} is a fixed amount, so it can't also have an upper bound.`,
        );
      }
      return;
    }
    if (max === null || max === undefined) {
      throw new BadRequestException(
        `${label} is a range, so it needs an upper bound.`,
      );
    }
    if (min >= max) {
      throw new BadRequestException(
        `${label}'s minimum must be less than its maximum.`,
      );
    }
  }

  /**
   * Rule 1 — the derived one. The offer type's flags decide which package fields
   * apply, in BOTH directions: a flag that is set makes its package required, and
   * a flag that is clear makes it forbidden. Throws on violation.
   *
   * Note there is no "no package supplied → nothing to check" shortcut: the
   * required direction is exactly the case where nothing was supplied, so an
   * early return there would let an internship drive save with no stipend at all.
   */
  private async assertPackageMatchesOfferType(
    offerTypeId: number | null | undefined,
    v: ScopedValues,
    where: string,
  ): Promise<void> {
    const hasStipend = v.stipend_mode != null;
    const hasCtc = v.ctc_mode != null;

    if (offerTypeId == null) {
      // Callers guarantee an offer type whenever it's in scope, so this only
      // fires when a package arrived without one.
      if (!hasStipend && !hasCtc) return;
      throw new BadRequestException(
        `${where}: a package needs an offer type — it decides whether the figure is a stipend or a CTC.`,
      );
    }
    const offer = await this.offerTypes.findOne({ where: { id: offerTypeId } });
    if (!offer) throw new BadRequestException(`${where}: unknown offer type.`);

    if (hasStipend && !offer.is_internship) {
      throw new BadRequestException(
        `${where}: "${offer.name}" isn't an internship, so it can't carry a stipend.`,
      );
    }
    if (hasCtc && !offer.is_full_time) {
      throw new BadRequestException(
        `${where}: "${offer.name}" isn't a full-time role, so it can't carry a CTC.`,
      );
    }
    if (offer.is_internship && !hasStipend) {
      throw new BadRequestException(
        `${where}: "${offer.name}" is an internship, so it needs a stipend.`,
      );
    }
    if (offer.is_full_time && !hasCtc) {
      throw new BadRequestException(
        `${where}: "${offer.name}" is a full-time role, so it needs a CTC.`,
      );
    }

    this.assertAmount(
      v.stipend_mode,
      v.stipend_min,
      v.stipend_max,
      `${where}: the stipend`,
    );
    this.assertAmount(v.ctc_mode, v.ctc_min, v.ctc_max, `${where}: the CTC`);
  }

  /** True when any part of the bond field set is present. */
  private bondPresent(v: ScopedValues): boolean {
    return (
      v.has_bond != null ||
      v.bond_years != null ||
      (v.bond_desc !== undefined && v.bond_desc !== null)
    );
  }

  /** Bond details only mean something when there IS a bond. */
  private assertBond(v: ScopedValues, where: string): void {
    if (v.has_bond === true && (v.bond_years == null || v.bond_years === 0)) {
      throw new BadRequestException(
        `${where}: a bond needs a duration in years.`,
      );
    }
    if (v.has_bond !== true && (v.bond_years != null || v.bond_desc != null)) {
      throw new BadRequestException(
        `${where}: bond details are set, but the bond itself isn't marked Yes.`,
      );
    }
  }

  /**
   * Validate a drive + its profiles as a whole. Everything cross-field lands
   * here because the rules span the drive's scopes, the offer type's flags and
   * the profile array all at once — no single DTO object can see all three.
   */
  private async validate(dto: CreateDriveDto): Promise<void> {
    // --- profile_type bounds the profile count ---------------------------
    if (dto.profile_type === 'single' && dto.profiles.length !== 1) {
      throw new BadRequestException(
        'A single-profile drive has exactly one designation. Switch to Multi profile to add more.',
      );
    }

    // --- no duplicate designations ---------------------------------------
    const seen = new Set<number>();
    for (const p of dto.profiles) {
      if (seen.has(p.designation_id)) {
        throw new BadRequestException(
          'The same designation appears twice — each designation can only be listed once per drive.',
        );
      }
      seen.add(p.designation_id);
    }

    // --- rule 2: each scoped field lives on exactly one side -------------
    // Spelled out per field rather than looped over a key map: the four fields
    // test presence differently (an id, an array, a group of bond columns), and
    // a generic loop needs dynamic indexing that hides that behind casts.
    const pkg = (v: ScopedValues) =>
      v.stipend_mode != null || v.ctc_mode != null;

    this.assertSide(
      dto.offer_type_id != null,
      'drive',
      dto.offer_type_scope,
      'The offer type',
    );
    this.assertSide(
      !!dto.job_location_ids?.length,
      'drive',
      dto.job_location_scope,
      'The job location',
    );
    this.assertSide(
      !!dto.placement_category_ids?.length,
      'drive',
      dto.placement_category_scope,
      'The placement category',
    );
    this.assertSide(this.bondPresent(dto), 'drive', dto.bond_scope, 'The bond');
    // Packages follow the offer type's scope — they have no switch of their own.
    this.assertSide(pkg(dto), 'drive', dto.offer_type_scope, 'The package');

    for (const p of dto.profiles) {
      this.assertSide(
        p.offer_type_id != null,
        'designation',
        dto.offer_type_scope,
        'The offer type',
      );
      this.assertSide(
        !!p.job_location_ids?.length,
        'designation',
        dto.job_location_scope,
        'The job location',
      );
      this.assertSide(
        !!p.placement_category_ids?.length,
        'designation',
        dto.placement_category_scope,
        'The placement category',
      );
      this.assertSide(
        this.bondPresent(p),
        'designation',
        dto.bond_scope,
        'The bond',
      );
      this.assertSide(
        pkg(p),
        'designation',
        dto.offer_type_scope,
        'The package',
      );
    }

    // --- required-when-drive-scoped --------------------------------------
    if (dto.offer_type_scope === 'drive' && dto.offer_type_id == null) {
      throw new BadRequestException('The drive needs an offer type.');
    }
    if (dto.job_location_scope === 'drive' && !dto.job_location_ids?.length) {
      throw new BadRequestException(
        'The drive needs at least one job location.',
      );
    }
    if (
      dto.placement_category_scope === 'drive' &&
      !dto.placement_category_ids?.length
    ) {
      throw new BadRequestException(
        'The drive needs at least one placement category.',
      );
    }
    if (dto.bond_scope === 'drive' && dto.has_bond == null) {
      throw new BadRequestException('Say whether the drive has a bond.');
    }

    // --- required-when-designation-scoped --------------------------------
    for (const [i, p] of dto.profiles.entries()) {
      const where = `Designation ${i + 1}`;
      if (dto.offer_type_scope === 'designation' && p.offer_type_id == null) {
        throw new BadRequestException(`${where} needs an offer type.`);
      }
      if (
        dto.job_location_scope === 'designation' &&
        !p.job_location_ids?.length
      ) {
        throw new BadRequestException(
          `${where} needs at least one job location.`,
        );
      }
      if (
        dto.placement_category_scope === 'designation' &&
        !p.placement_category_ids?.length
      ) {
        throw new BadRequestException(
          `${where} needs at least one placement category.`,
        );
      }
      if (dto.bond_scope === 'designation' && p.has_bond == null) {
        throw new BadRequestException(`${where}: say whether it has a bond.`);
      }
    }

    // --- rule 1: packages match the offer type's flags -------------------
    if (dto.offer_type_scope === 'drive') {
      await this.assertPackageMatchesOfferType(
        dto.offer_type_id,
        dto,
        'The drive',
      );
    } else {
      for (const [i, p] of dto.profiles.entries()) {
        await this.assertPackageMatchesOfferType(
          p.offer_type_id,
          p,
          `Designation ${i + 1}`,
        );
      }
    }

    // --- bond details ----------------------------------------------------
    if (dto.bond_scope === 'drive') this.assertBond(dto, 'The drive');
    else {
      dto.profiles.forEach((p, i) =>
        this.assertBond(p, `Designation ${i + 1}`),
      );
    }

    // --- referenced rows exist -------------------------------------------
    await this.assertRefsExist(dto);
  }

  /**
   * Every referenced lookup / company row must exist. Checked up front so a bad
   * id fails as a 400 naming the field, rather than as an FK violation from the
   * database.
   */
  private async assertRefsExist(dto: CreateDriveDto): Promise<void> {
    const company = await this.companies.findOne({
      where: { id: dto.company_id },
    });
    if (!company) throw new BadRequestException('Unknown company.');

    const designationIds = dto.profiles.map((p) => p.designation_id);
    await this.assertAllExist(this.designations, designationIds, 'designation');

    const offerTypeIds = [
      dto.offer_type_id,
      ...dto.profiles.map((p) => p.offer_type_id),
    ].filter((v): v is number => v != null);
    await this.assertAllExist(this.offerTypes, offerTypeIds, 'offer type');

    const categoryIds = [
      ...(dto.placement_category_ids ?? []),
      ...dto.profiles.flatMap((p) => p.placement_category_ids ?? []),
    ];
    await this.assertAllExist(
      this.placementCategories,
      categoryIds,
      'placement category',
    );

    const locationIds = [
      ...(dto.job_location_ids ?? []),
      ...dto.profiles.flatMap((p) => p.job_location_ids ?? []),
    ];
    await this.assertAllExist(this.jobLocations, locationIds, 'job location');

    if (dto.company_category_ids?.length) {
      await this.assertAllExist(
        this.companyCategories,
        dto.company_category_ids,
        'company category',
      );
    }
  }

  private async assertAllExist(
    repo: Repository<{ id: number }>,
    ids: number[],
    label: string,
  ): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = await repo.find({
      where: { id: In(unique) },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const missing = unique.filter((id) => !found.some((f) => f.id === id));
      throw new BadRequestException(`Unknown ${label}: ${missing.join(', ')}.`);
    }
  }

  // ---- Reads --------------------------------------------------------------

  /**
   * Paginated drive list. The classifier joins are M:N and multiply rows, so —
   * exactly as `listCompanies` does — we never `getManyAndCount()` off this
   * builder: we derive a distinct total plus a distinct ordered page of ids, then
   * hydrate those ids.
   */
  async list(query: DriveQueryDto) {
    const qb = this.drives
      .createQueryBuilder('d')
      .innerJoin('d.company', 'company');

    if (query.company_id) {
      qb.andWhere('d.company_id = :cid', { cid: query.company_id });
    }
    if (query.statuses?.length) {
      qb.andWhere('d.status IN (:...statuses)', { statuses: query.statuses });
    }
    // Facet filters. Each is added ONLY when set, so an unfiltered list runs the
    // same SQL as before. Classifiers use correlated EXISTS rather than M:N joins
    // so the base query stays one-row-per-drive (no DISTINCT blow-up). Offer type
    // and placement category are scope-switched, so they match a value on the
    // drive OR on any of its designations (drive_profiles).
    if (query.company_ids?.length) {
      qb.andWhere('d.company_id IN (:...companyIds)', {
        companyIds: query.company_ids,
      });
    }
    if (query.company_category_ids?.length) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM drive_company_categories_link cc
                 WHERE cc.drive_id = d.id AND cc.category_id IN (:...ccIds))`,
        { ccIds: query.company_category_ids },
      );
    }
    if (query.offer_type_ids?.length) {
      qb.andWhere(
        `(d.offer_type_id IN (:...otIds)
          OR EXISTS (SELECT 1 FROM drive_profiles p
                     WHERE p.drive_id = d.id AND p.offer_type_id IN (:...otIds)))`,
        { otIds: query.offer_type_ids },
      );
    }
    if (query.placement_category_ids?.length) {
      qb.andWhere(
        `(EXISTS (SELECT 1 FROM drive_placement_categories_link pl
                  WHERE pl.drive_id = d.id
                    AND pl.placement_category_id IN (:...pcIds))
          OR EXISTS (SELECT 1 FROM drive_profiles p
                     JOIN drive_profile_placement_categories_link ppl
                       ON ppl.drive_profile_id = p.id
                     WHERE p.drive_id = d.id
                       AND ppl.placement_category_id IN (:...pcIds)))`,
        { pcIds: query.placement_category_ids },
      );
    }
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('d.drive_name ILIKE :s', { s: `%${query.search}%` }).orWhere(
            'company.name ILIKE :s',
            { s: `%${query.search}%` },
          );
        }),
      );
    }

    const totalRaw = await qb
      .clone()
      .select('COUNT(DISTINCT d.id)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(totalRaw?.cnt ?? 0);

    // DISTINCT + ORDER BY needs the ordering column in the select list; every
    // sortable column is 1:1 per drive so it's safe. `d.id` is a stable
    // tiebreaker so pagination never drifts between pages.
    const sortCol = DRIVE_SORT_COLUMN[query.sort_by];
    const sortDir = query.sort_dir === 'asc' ? 'ASC' : 'DESC';
    const idRows = await qb
      .clone()
      .select('d.id', 'id')
      .addSelect(sortCol, 'sort_val')
      .distinct(true)
      .orderBy(sortCol, sortDir, 'NULLS LAST')
      .addOrderBy('d.id', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getRawMany<{ id: number }>();
    const pageIds = idRows.map((r) => Number(r.id));

    if (pageIds.length === 0) {
      return { items: [], total, page: query.page, limit: query.limit };
    }

    const rows = await this.drives.find({
      where: { id: In(pageIds) },
      relations: {
        company: true,
        offer_type: true,
        placement_categories: true,
        company_categories: true,
        job_locations: true,
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Designation names + count per drive, for the card/table summary.
    const profiles = await this.profiles.find({
      where: { drive_id: In(pageIds) },
      relations: { designation: true },
      order: { sort_order: 'ASC', id: 'ASC' },
    });
    const profilesByDrive = new Map<number, DriveProfile[]>();
    for (const p of profiles) {
      const list = profilesByDrive.get(p.drive_id) ?? [];
      list.push(p);
      profilesByDrive.set(p.drive_id, list);
    }

    const ordered = pageIds
      .map((id) => byId.get(id))
      .filter((d): d is Drive => !!d);

    const items = await Promise.all(
      ordered.map(async (d) => {
        const ps = profilesByDrive.get(d.id) ?? [];
        return {
          id: d.id,
          drive_name: d.drive_name,
          profile_type: d.profile_type,
          status: d.status,
          company: {
            id: d.company.id,
            name: d.company.name,
            // Presigned + Redis-cached, so this is cheap per row and the URL is
            // stable enough for the browser image cache to actually hit.
            logo_url: d.company.logo_key
              ? await this.storage.getCachedReadUrl(d.company.logo_key)
              : null,
          },
          company_categories: (d.company_categories ?? []).map(chip),
          offer_type: d.offer_type ? chip(d.offer_type) : null,
          placement_categories: (d.placement_categories ?? []).map(chip),
          job_locations: (d.job_locations ?? []).map(chip),
          designations: ps.map((p) => chip(p.designation)),
          designation_count: ps.length,
          registration_end_date: d.registration_end_date,
          drive_date: d.drive_date,
          updated_at: d.updated_at,
        };
      }),
    );

    return { items, total, page: query.page, limit: query.limit };
  }

  /** One drive with everything needed to render or re-edit it. */
  async get(id: number) {
    const drive = await this.drives.findOne({
      where: { id },
      relations: {
        company: true,
        offer_type: true,
        placement_categories: true,
        company_categories: true,
        job_locations: true,
      },
    });
    if (!drive) throw new NotFoundException('Drive not found.');

    const profiles = await this.profiles.find({
      where: { drive_id: id },
      relations: {
        designation: true,
        offer_type: true,
        placement_categories: true,
        job_locations: true,
      },
      order: { sort_order: 'ASC', id: 'ASC' },
    });

    const files = await this.attachments.find({
      where: { drive_profile_id: In(profiles.map((p) => p.id)) },
      order: { id: 'ASC' },
    });
    const filesByProfile = new Map<number, DriveProfileAttachment[]>();
    for (const f of files) {
      const list = filesByProfile.get(f.drive_profile_id) ?? [];
      list.push(f);
      filesByProfile.set(f.drive_profile_id, list);
    }

    return {
      id: drive.id,
      drive_name: drive.drive_name,
      profile_type: drive.profile_type,
      status: drive.status,
      company: {
        id: drive.company.id,
        name: drive.company.name,
        website: drive.company.website ?? null,
        logo_url: drive.company.logo_key
          ? await this.storage.getCachedReadUrl(drive.company.logo_key)
          : null,
      },
      company_categories: (drive.company_categories ?? []).map(chip),

      offer_type_scope: drive.offer_type_scope,
      job_location_scope: drive.job_location_scope,
      placement_category_scope: drive.placement_category_scope,
      bond_scope: drive.bond_scope,

      offer_type: drive.offer_type ? chip(drive.offer_type) : null,
      placement_categories: (drive.placement_categories ?? []).map(chip),
      job_locations: (drive.job_locations ?? []).map(chip),
      has_bond: drive.has_bond,
      bond_years: drive.bond_years,
      bond_desc: drive.bond_desc,
      stipend_mode: drive.stipend_mode,
      stipend_min: drive.stipend_min,
      stipend_max: drive.stipend_max,
      ctc_mode: drive.ctc_mode,
      ctc_min: drive.ctc_min,
      ctc_max: drive.ctc_max,

      spoc_email: drive.spoc_email,
      spoc_contact: drive.spoc_contact,
      registration_end_date: drive.registration_end_date,
      drive_date: drive.drive_date,

      profiles: await Promise.all(
        profiles.map(async (p) => ({
          id: p.id,
          designation: chip(p.designation),
          jd: p.jd,
          sort_order: p.sort_order,
          offer_type: p.offer_type ? chip(p.offer_type) : null,
          placement_categories: (p.placement_categories ?? []).map(chip),
          job_locations: (p.job_locations ?? []).map(chip),
          has_bond: p.has_bond,
          bond_years: p.bond_years,
          bond_desc: p.bond_desc,
          stipend_mode: p.stipend_mode,
          stipend_min: p.stipend_min,
          stipend_max: p.stipend_max,
          ctc_mode: p.ctc_mode,
          ctc_min: p.ctc_min,
          ctc_max: p.ctc_max,
          attachments: await Promise.all(
            (filesByProfile.get(p.id) ?? []).map(async (f) => ({
              id: f.id,
              file_name: f.file_name,
              content_type: f.content_type,
              size_bytes: f.size_bytes,
              // Presigned — `file_key` never leaves the server.
              file_url: await this.storage.getCachedReadUrl(f.file_key),
              created_at: f.created_at,
            })),
          ),
        })),
      ),

      created_at: drive.created_at,
      updated_at: drive.updated_at,
    };
  }

  /**
   * Companies the drive form can pick from.
   *
   * Served from THIS screen rather than reusing the corporate-relations list:
   * those endpoints are gated by their own screens, so a placement manager
   * holding only `drive_management.drives.manage` would 403 on their own form.
   * A drive needs a company, so the picker belongs to the drives screen.
   *
   * Active companies only — a drive can't be raised against a retired one.
   */
  async companyOptions() {
    const rows = await this.companies.find({
      where: { is_active: true },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return rows.map(chip);
  }

  /**
   * The full company-category master list — the options for the drive form's
   * category multi-select, so a category can always be added/removed regardless
   * of what the picked company happens to be tagged with (the company's own tags
   * only pre-fill the selection, via `companyDefaults`).
   *
   * Served from THIS screen for the same reason as `companyOptions` — a
   * placement manager holding only the drives grant would 403 on the
   * corporate-relations attributes endpoint.
   */
  async companyCategoryOptions() {
    const rows = await this.companyCategories.find({
      where: { is_active: true },
      select: { id: true, name: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
    return rows.map(chip);
  }

  /** Active offer types, for the drive list's offer-type filter. */
  async offerTypeOptions() {
    const rows = await this.offerTypes.find({
      where: { is_active: true },
      select: { id: true, name: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
    return rows.map(chip);
  }

  /** Active placement categories, for the drive list's placement-category filter. */
  async placementCategoryOptions() {
    const rows = await this.placementCategories.find({
      where: { is_active: true },
      select: { id: true, name: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });
    return rows.map(chip);
  }

  /**
   * The company's own categories — the drive form seeds its category
   * multi-select from these when a company is picked.
   */
  async companyDefaults(companyId: number) {
    const company = await this.companies.findOne({
      where: { id: companyId },
      relations: { categories: true },
    });
    if (!company) throw new NotFoundException('Company not found.');
    return {
      id: company.id,
      name: company.name,
      logo_url: company.logo_key
        ? await this.storage.getCachedReadUrl(company.logo_key)
        : null,
      categories: (company.categories ?? []).map(chip),
    };
  }

  // ---- Status -------------------------------------------------------------

  /** Set a drive's lifecycle status. Free transition — any value, any time. */
  async updateStatus(id: number, status: DriveStatus): Promise<{ id: number }> {
    const res = await this.drives.update(id, { status });
    if (!res.affected) throw new NotFoundException('Drive not found.');
    return { id };
  }

  // ---- Eligibility --------------------------------------------------------

  /**
   * The eligibility options for the drive's Eligibility form — the programme
   * master list plus the graduating years of every admission-year batch (the
   * batch's admission year + 4). Derived from the admission-years master rather
   * than from students, so the list is complete regardless of whether students
   * are loaded. Served from this screen so the form needs only a drives grant
   * (same rationale as `companyCategoryOptions`). Entry types and genders are
   * fixed enums the client renders from constants, so they aren't returned here.
   */
  async eligibilityOptions() {
    const programmes = await this.programmes.find({
      where: { is_active: true },
      select: { id: true, display_name: true, name: true },
      order: { name: 'ASC' },
    });
    const years = await this.admissionYears.find({
      where: { is_active: true },
      select: { year: true },
      order: { year: 'DESC' },
    });
    return {
      programmes: programmes.map((p) => ({
        id: p.id,
        name: p.display_name || p.name,
      })),
      // A batch admitted in year Y graduates in Y + 4.
      passout_years: years.map((a) => a.year + 4),
    };
  }

  /** A drive's eligibility, or all-empty defaults when none is saved yet. */
  async getEligibility(driveId: number) {
    const drive = await this.drives.findOne({ where: { id: driveId } });
    if (!drive) throw new NotFoundException('Drive not found.');
    const row = await this.eligibility.findOne({
      where: { drive_id: driveId },
      relations: { eligible_programmes: true },
    });
    return {
      programme_ids: (row?.eligible_programmes ?? []).map((p) => p.id),
      entry_types: row?.entry_types ?? [],
      genders: row?.genders ?? [],
      passout_years: row?.passout_years ?? [],
      allow_backlog_history: row?.allow_backlog_history ?? false,
      max_current_backlogs: row?.max_current_backlogs ?? null,
      min_tenth_percentage: num(row?.min_tenth_percentage ?? null),
      min_twelfth_or_diploma_percentage: num(
        row?.min_twelfth_or_diploma_percentage ?? null,
      ),
      min_btech_cgpa: num(row?.min_btech_cgpa ?? null),
    };
  }

  /**
   * A drive's eligibility with ids/codes resolved to human labels, plus a
   * `has_restrictions` flag. Consumed by the employee Overview and — since it
   * carries only names, never the employee-only options endpoint — the student
   * drive view. Empty arrays / null thresholds mean "no restriction on that
   * axis"; `has_restrictions` is false only when every axis is open.
   */
  async eligibilitySummary(driveId: number) {
    const raw = await this.getEligibility(driveId);

    const programmeRows = raw.programme_ids.length
      ? await this.programmes.find({
          where: { id: In(raw.programme_ids) },
          select: { id: true, display_name: true, name: true },
          order: { name: 'ASC' },
        })
      : [];

    // Backlog history defaults to false for an unconfigured drive, so it can't
    // tell "saved with no backlogs allowed" from "never set" — it never flips
    // this flag. Only positively-set axes count as a restriction; the backlog
    // policy is still shown alongside the rest when other criteria exist.
    const has_restrictions =
      raw.programme_ids.length > 0 ||
      raw.entry_types.length > 0 ||
      raw.genders.length > 0 ||
      raw.passout_years.length > 0 ||
      raw.max_current_backlogs !== null ||
      raw.min_tenth_percentage !== null ||
      raw.min_twelfth_or_diploma_percentage !== null ||
      raw.min_btech_cgpa !== null;

    return {
      programmes: programmeRows.map((p) => p.display_name || p.name),
      entry_types: raw.entry_types.map((v) => ENTRY_TYPE_LABELS[v] ?? String(v)),
      genders: raw.genders.map((g) => GENDER_LABELS[g] ?? g),
      passout_years: raw.passout_years,
      allow_backlog_history: raw.allow_backlog_history,
      max_current_backlogs: raw.max_current_backlogs,
      min_tenth_percentage: raw.min_tenth_percentage,
      min_twelfth_or_diploma_percentage: raw.min_twelfth_or_diploma_percentage,
      min_btech_cgpa: raw.min_btech_cgpa,
      has_restrictions,
    };
  }

  /** Upsert a drive's eligibility, reconciling its programmes join rows. */
  async saveEligibility(
    driveId: number,
    dto: UpdateDriveEligibilityDto,
  ): Promise<{ id: number }> {
    const drive = await this.drives.findOne({ where: { id: driveId } });
    if (!drive) throw new NotFoundException('Drive not found.');

    if (dto.programme_ids?.length) {
      await this.assertAllExist(this.programmes, dto.programme_ids, 'programme');
    }

    const row =
      (await this.eligibility.findOne({ where: { drive_id: driveId } })) ??
      this.eligibility.create({ drive_id: driveId });

    row.entry_types = dto.entry_types ?? [];
    row.genders = dto.genders ?? [];
    row.passout_years = dto.passout_years ?? [];
    row.allow_backlog_history = dto.allow_backlog_history ?? false;
    // A current-backlog cap is only meaningful when history is allowed — a
    // student with any current backlog necessarily has backlog history. Force
    // it null otherwise so it can't leak into the summary or filter auto-patch.
    row.max_current_backlogs = row.allow_backlog_history
      ? (dto.max_current_backlogs ?? null)
      : null;
    row.min_tenth_percentage = money(dto.min_tenth_percentage);
    row.min_twelfth_or_diploma_percentage = money(
      dto.min_twelfth_or_diploma_percentage,
    );
    row.min_btech_cgpa = money(dto.min_btech_cgpa);
    row.eligible_programmes = (dto.programme_ids ?? []).map(
      (id) => ({ id }) as Programme,
    );

    const saved = await this.eligibility.save(row);
    return { id: saved.id };
  }

  // ---- Writes -------------------------------------------------------------

  /** Copy the scoped values onto a drive/profile row, blanking the other side. */
  private applyScoped(
    row: Drive | DriveProfile,
    v: ScopedValues,
    keep: {
      offer_type: boolean;
      bond: boolean;
    },
  ): void {
    // Blank rather than leave stale: flipping a scope from 'drive' to
    // 'designation' has to clear the drive's copy, or a later read of the wrong
    // side would resurrect a value the user thinks they moved.
    // (placement_categories is a join-table relation, reconciled by assigning
    // the array alongside job_locations in create/update — not here.)
    row.offer_type_id = keep.offer_type ? (v.offer_type_id ?? null) : null;

    row.has_bond = keep.bond ? (v.has_bond ?? null) : null;
    row.bond_years = keep.bond ? (v.bond_years ?? null) : null;
    row.bond_desc = keep.bond ? (v.bond_desc ?? null) : null;

    // Packages follow the offer type's side.
    row.stipend_mode = keep.offer_type ? (v.stipend_mode ?? null) : null;
    row.stipend_min = keep.offer_type ? money(v.stipend_min) : null;
    row.stipend_max = keep.offer_type ? money(v.stipend_max) : null;
    row.ctc_mode = keep.offer_type ? (v.ctc_mode ?? null) : null;
    row.ctc_min = keep.offer_type ? money(v.ctc_min) : null;
    row.ctc_max = keep.offer_type ? money(v.ctc_max) : null;
  }

  async create(dto: CreateDriveDto, actorId: number): Promise<{ id: number }> {
    await this.validate(dto);

    return this.dataSource.transaction(async (em) => {
      const drive = em.create(Drive, {
        company_id: dto.company_id,
        drive_name: dto.drive_name,
        profile_type: dto.profile_type,
        status: dto.status ?? 'draft',
        offer_type_scope: dto.offer_type_scope,
        job_location_scope: dto.job_location_scope,
        placement_category_scope: dto.placement_category_scope,
        bond_scope: dto.bond_scope,
        spoc_email: dto.spoc_email ?? null,
        spoc_contact: dto.spoc_contact ?? null,
        registration_end_date: dto.registration_end_date ?? null,
        drive_date: dto.drive_date ?? null,
        created_by_employee_id: actorId,
      });
      this.applyScoped(drive, dto, {
        offer_type: dto.offer_type_scope === 'drive',
        bond: dto.bond_scope === 'drive',
      });
      drive.company_categories = (dto.company_category_ids ?? []).map(
        (id) => ({ id }) as CompanyCategory,
      );
      drive.job_locations =
        dto.job_location_scope === 'drive'
          ? (dto.job_location_ids ?? []).map(
              (id) => ({ id }) as DriveJobLocation,
            )
          : [];
      drive.placement_categories =
        dto.placement_category_scope === 'drive'
          ? (dto.placement_category_ids ?? []).map(
              (id) => ({ id }) as DrivePlacementCategory,
            )
          : [];
      const saved = await em.save(drive);

      for (const [i, p] of dto.profiles.entries()) {
        const profile = em.create(DriveProfile, {
          drive_id: saved.id,
          designation_id: p.designation_id,
          jd: p.jd ?? null,
          sort_order: p.sort_order ?? i,
        });
        this.applyScoped(profile, p, {
          offer_type: dto.offer_type_scope === 'designation',
          bond: dto.bond_scope === 'designation',
        });
        profile.job_locations =
          dto.job_location_scope === 'designation'
            ? (p.job_location_ids ?? []).map(
                (id) => ({ id }) as DriveJobLocation,
              )
            : [];
        profile.placement_categories =
          dto.placement_category_scope === 'designation'
            ? (p.placement_category_ids ?? []).map(
                (id) => ({ id }) as DrivePlacementCategory,
              )
            : [];
        await em.save(profile);
      }

      return { id: saved.id };
    });
  }

  /**
   * Replace a drive. `profiles`, when present, is the complete desired set:
   * rows are matched by id, missing ones are deleted (taking their attachments
   * with them via CASCADE), and new ones are inserted.
   */
  async update(id: number, dto: UpdateDriveDto): Promise<{ id: number }> {
    const existing = await this.drives.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Drive not found.');

    // Validate the MERGED result, not the patch: a rule like "stipend needs an
    // internship offer type" spans fields the request may not have named, so
    // checking the patch alone would let a half-edit through.
    const merged = await this.mergeForValidation(id, existing, dto);
    await this.validate(merged);

    return this.dataSource.transaction(async (em) => {
      const drive = await em.findOne(Drive, {
        where: { id },
        relations: {
          company_categories: true,
          job_locations: true,
          placement_categories: true,
        },
      });
      if (!drive) throw new NotFoundException('Drive not found.');

      drive.company_id = merged.company_id;
      drive.drive_name = merged.drive_name;
      drive.profile_type = merged.profile_type;
      if (merged.status) drive.status = merged.status;
      drive.offer_type_scope = merged.offer_type_scope;
      drive.job_location_scope = merged.job_location_scope;
      drive.placement_category_scope = merged.placement_category_scope;
      drive.bond_scope = merged.bond_scope;
      drive.spoc_email = merged.spoc_email ?? null;
      drive.spoc_contact = merged.spoc_contact ?? null;
      drive.registration_end_date = merged.registration_end_date ?? null;
      drive.drive_date = merged.drive_date ?? null;

      this.applyScoped(drive, merged, {
        offer_type: merged.offer_type_scope === 'drive',
        bond: merged.bond_scope === 'drive',
      });
      drive.company_categories = (merged.company_category_ids ?? []).map(
        (cid) => ({ id: cid }) as CompanyCategory,
      );
      drive.job_locations =
        merged.job_location_scope === 'drive'
          ? (merged.job_location_ids ?? []).map(
              (lid) => ({ id: lid }) as DriveJobLocation,
            )
          : [];
      drive.placement_categories =
        merged.placement_category_scope === 'drive'
          ? (merged.placement_category_ids ?? []).map(
              (cid) => ({ id: cid }) as DrivePlacementCategory,
            )
          : [];
      await em.save(drive);

      // Reconcile the profile set.
      const stored = await em.find(DriveProfile, { where: { drive_id: id } });
      const keepIds = merged.profiles
        .map((p) => p.id)
        .filter((v): v is number => v != null);
      const doomed = stored.filter((s) => !keepIds.includes(s.id));

      // Delete the objects behind the doomed profiles' attachments before the
      // rows cascade away — once the row is gone the key is unreachable and the
      // bytes would linger in the bucket forever.
      if (doomed.length) {
        const files = await em.find(DriveProfileAttachment, {
          where: { drive_profile_id: In(doomed.map((d) => d.id)) },
        });
        await Promise.all(
          files.map((f) => this.storage.deleteObject(f.file_key)),
        );
        await em.delete(DriveProfile, { id: In(doomed.map((d) => d.id)) });
      }

      for (const [i, p] of merged.profiles.entries()) {
        const profile =
          p.id != null
            ? await em.findOne(DriveProfile, {
                where: { id: p.id, drive_id: id },
                relations: {
                  job_locations: true,
                  placement_categories: true,
                },
              })
            : em.create(DriveProfile, { drive_id: id });
        if (!profile) {
          throw new BadRequestException(
            `Designation ${i + 1} doesn't belong to this drive.`,
          );
        }
        profile.designation_id = p.designation_id;
        profile.jd = p.jd ?? null;
        profile.sort_order = p.sort_order ?? i;
        this.applyScoped(profile, p, {
          offer_type: merged.offer_type_scope === 'designation',
          bond: merged.bond_scope === 'designation',
        });
        profile.job_locations =
          merged.job_location_scope === 'designation'
            ? (p.job_location_ids ?? []).map(
                (lid) => ({ id: lid }) as DriveJobLocation,
              )
            : [];
        profile.placement_categories =
          merged.placement_category_scope === 'designation'
            ? (p.placement_category_ids ?? []).map(
                (cid) => ({ id: cid }) as DrivePlacementCategory,
              )
            : [];
        await em.save(profile);
      }

      return { id };
    });
  }

  /**
   * Fold a PATCH over the stored drive so `validate()` always sees a complete
   * drive. Fields the request didn't name keep their stored value.
   */
  private async mergeForValidation(
    id: number,
    existing: Drive,
    dto: UpdateDriveDto,
  ): Promise<CreateDriveDto> {
    const stored = await this.drives.findOne({
      where: { id },
      relations: {
        company_categories: true,
        job_locations: true,
        placement_categories: true,
      },
    });
    const storedProfiles = await this.profiles.find({
      where: { drive_id: id },
      relations: { job_locations: true, placement_categories: true },
      order: { sort_order: 'ASC', id: 'ASC' },
    });

    const pick = <T>(patched: T | undefined, current: T): T =>
      patched !== undefined ? patched : current;

    return {
      company_id: pick(dto.company_id, existing.company_id),
      drive_name: pick(dto.drive_name, existing.drive_name),
      profile_type: pick(dto.profile_type, existing.profile_type),
      status: pick(dto.status, existing.status),
      offer_type_scope: pick(dto.offer_type_scope, existing.offer_type_scope),
      job_location_scope: pick(
        dto.job_location_scope,
        existing.job_location_scope,
      ),
      placement_category_scope: pick(
        dto.placement_category_scope,
        existing.placement_category_scope,
      ),
      bond_scope: pick(dto.bond_scope, existing.bond_scope),
      company_category_ids: pick(
        dto.company_category_ids,
        (stored?.company_categories ?? []).map((c) => c.id),
      ),
      spoc_email: pick(dto.spoc_email, existing.spoc_email),
      spoc_contact: pick(dto.spoc_contact, existing.spoc_contact),
      registration_end_date: pick(
        dto.registration_end_date,
        existing.registration_end_date,
      ),
      drive_date: pick(dto.drive_date, existing.drive_date),

      offer_type_id: pick(dto.offer_type_id, existing.offer_type_id),
      job_location_ids: pick(
        dto.job_location_ids,
        (stored?.job_locations ?? []).map((l) => l.id),
      ),
      placement_category_ids: pick(
        dto.placement_category_ids,
        (stored?.placement_categories ?? []).map((c) => c.id),
      ),
      has_bond: pick(dto.has_bond, existing.has_bond),
      bond_years: pick(dto.bond_years, existing.bond_years),
      bond_desc: pick(dto.bond_desc, existing.bond_desc),
      stipend_mode: pick(dto.stipend_mode, existing.stipend_mode),
      stipend_min: pick(dto.stipend_min, num(existing.stipend_min)),
      stipend_max: pick(dto.stipend_max, num(existing.stipend_max)),
      ctc_mode: pick(dto.ctc_mode, existing.ctc_mode),
      ctc_min: pick(dto.ctc_min, num(existing.ctc_min)),
      ctc_max: pick(dto.ctc_max, num(existing.ctc_max)),

      profiles: pick(
        dto.profiles,
        storedProfiles.map((p) => ({
          id: p.id,
          designation_id: p.designation_id,
          jd: p.jd as Record<string, unknown> | null,
          sort_order: p.sort_order,
          offer_type_id: p.offer_type_id,
          job_location_ids: (p.job_locations ?? []).map((l) => l.id),
          placement_category_ids: (p.placement_categories ?? []).map(
            (c) => c.id,
          ),
          has_bond: p.has_bond,
          bond_years: p.bond_years,
          bond_desc: p.bond_desc as Record<string, unknown> | null,
          stipend_mode: p.stipend_mode,
          stipend_min: num(p.stipend_min),
          stipend_max: num(p.stipend_max),
          ctc_mode: p.ctc_mode,
          ctc_min: num(p.ctc_min),
          ctc_max: num(p.ctc_max),
        })),
      ),
    } as CreateDriveDto;
  }

  async remove(id: number): Promise<void> {
    const drive = await this.drives.findOne({ where: { id } });
    if (!drive) throw new NotFoundException('Drive not found.');

    const profiles = await this.profiles.find({ where: { drive_id: id } });
    const files = profiles.length
      ? await this.attachments.find({
          where: { drive_profile_id: In(profiles.map((p) => p.id)) },
        })
      : [];

    // Delete bytes first: the rows cascade away with the drive, and once they're
    // gone the keys are unreachable and the objects would leak.
    await Promise.all(files.map((f) => this.storage.deleteObject(f.file_key)));
    await this.drives.delete({ id });
  }

  // ---- Attachments --------------------------------------------------------

  async addAttachment(
    profileId: number,
    file: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size: number;
    },
    actorId: number,
  ) {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Designation not found.');

    const ext = (file.originalname.split('.').pop() ?? 'bin')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const key = storageKey.driveJdAttachment(profile.drive_id, profileId, ext);
    await this.storage.putObject(key, file.buffer, file.mimetype);

    const row = await this.attachments.save(
      this.attachments.create({
        drive_profile_id: profileId,
        file_key: key,
        file_name: file.originalname.slice(0, 255),
        content_type: file.mimetype,
        size_bytes: file.size,
        uploaded_by: actorId,
      }),
    );

    return {
      id: row.id,
      file_name: row.file_name,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      file_url: await this.storage.getCachedReadUrl(key),
      created_at: row.created_at,
    };
  }

  async removeAttachment(attachmentId: number): Promise<void> {
    const row = await this.attachments.findOne({ where: { id: attachmentId } });
    if (!row) throw new NotFoundException('Attachment not found.');
    await this.storage.deleteObject(row.file_key);
    await this.attachments.delete({ id: attachmentId });
  }
}

/** Postgres hands back `numeric` as a string; validation compares numbers. */
function num(v: string | null): number | null {
  return v === null ? null : Number(v);
}
