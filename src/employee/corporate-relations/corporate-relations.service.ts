import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Department } from '../../admin/entities/department.entity';
import { Employee } from '../../admin/entities/employee.entity';
import { StorageService } from '../../storage/storage.service';
import { storageKey } from '../../storage/storage.constants';
import { DrivesService } from '../drive-management/drives.service';
import { DriveQueryDto } from '../drive-management/dto/drive.dto';
import { CompanyAttributesService } from './company-attributes.service';
import {
  COMPANY_TIERS,
  Company,
  OWNERSHIP_TYPES,
  RELATIONSHIP_STATUSES,
} from './entities/company.entity';
import {
  CompanyCategory,
  CompanyHiringMode,
  CompanyIndustry,
  CompanyRole,
  CompanySize,
  CompanySource,
  CompanyTag,
  CompanyType,
} from './entities/company-lookups.entity';
import {
  ActivityAction,
  ActivityChange,
  ActivityEntityType,
  CompanyActivityLog,
} from './entities/company-activity-log.entity';
import { CompanyContact } from './entities/company-contact.entity';
import {
  CompanyInteraction,
  INTERACTION_TYPES,
} from './entities/company-interaction.entity';
import {
  CompanyRelationshipMilestone,
  MILESTONE_TYPES,
} from './entities/company-relationship-milestone.entity';
import {
  ActivityQueryDto,
  ContactDto,
  InteractionDto,
  InteractionQueryDto,
  MilestoneDto,
  UpdateContactDto,
  UpdateInteractionDto,
} from './dto/activity.dto';
import {
  COMPANY_SORT_FIELDS,
  CompanyListQueryDto,
  CreateCompanyDto,
  UpdateCompanyDto,
} from './dto/company.dto';

/** Maps whitelisted sort keys to their DISTINCT-safe scalar column on `c`. */
const COMPANY_SORT_COLUMN: Record<
  (typeof COMPANY_SORT_FIELDS)[number],
  string
> = {
  name: 'c.name',
  tier: 'c.tier',
  relationship_status: 'c.relationship_status',
  package: 'c.package_max',
  last_engaged_on: 'c.last_engaged_on',
  updated_at: 'c.updated_at',
};

/** All company relations loaded for the detail view. */
const COMPANY_DETAIL_RELATIONS = {
  responsible_employee: true,
  categories: true,
  industries: true,
  types: true,
  sizes: true,
  sources: true,
  hiring_modes: true,
  roles: true,
  tags: true,
  eligible_branches: true,
} as const;

const asRefs = (ids?: number[]) =>
  ids ? ids.map((id) => ({ id })) : undefined;
const chip = (r: { id: number; name: string }) => ({ id: r.id, name: r.name });

/** 'mou_signed' → 'Mou signed'; 'prospect' → 'Prospect'. */
const humanize = (v: unknown): string =>
  v == null || v === ''
    ? '—'
    : String(v)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

/** Company scalar fields tracked for the activity diff (label per key). */
const TRACKED_COMPANY_FIELDS: Record<string, string> = {
  name: 'Name',
  short_name: 'Short name',
  website: 'Website',
  linkedin_url: 'LinkedIn',
  description: 'Description',
  general_email: 'Email',
  general_phone: 'Phone',
  ownership_type: 'Ownership type',
  tier: 'Tier',
  gstin: 'GSTIN',
  cin: 'CIN',
  pan: 'PAN',
  registration_number: 'Registration number',
  partnership_since: 'Partnership since',
  address_line1: 'Address line 1',
  address_line2: 'Address line 2',
  city: 'City',
  state: 'State',
  country: 'Country',
  pincode: 'Pincode',
  founded_year: 'Founded year',
  glassdoor_rating: 'Glassdoor rating',
  package_min: 'Package (min)',
  package_max: 'Package (max)',
  offers_internships: 'Offers internships',
  offers_ppo: 'Offers PPO',
};

/** Company relation → its DTO id-array key, for classifier-change detection. */
const CLASSIFIER_FIELDS: Record<string, keyof UpdateCompanyDto> = {
  categories: 'category_ids',
  industries: 'industry_ids',
  types: 'type_ids',
  sizes: 'size_ids',
  sources: 'source_ids',
  hiring_modes: 'hiring_mode_ids',
  roles: 'role_ids',
  tags: 'tag_ids',
  eligible_branches: 'eligible_branch_ids',
};

@Injectable()
export class CorporateRelationsService {
  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(CompanyContact)
    private readonly contacts: Repository<CompanyContact>,
    @InjectRepository(CompanyInteraction)
    private readonly interactions: Repository<CompanyInteraction>,
    @InjectRepository(CompanyRelationshipMilestone)
    private readonly milestones: Repository<CompanyRelationshipMilestone>,
    @InjectRepository(CompanyActivityLog)
    private readonly activity: Repository<CompanyActivityLog>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    private readonly attributes: CompanyAttributesService,
    private readonly storage: StorageService,
    private readonly drives: DrivesService,
  ) {}

  // ---- Ownership -----------------------------------------------------------

  /**
   * Guard for the officer surface: the acting employee must be the company's
   * single responsible officer. Also asserts the company exists. When
   * `ownerId` is undefined (manager surface) only existence is checked.
   */
  private async ensureAccess(
    companyId: number,
    ownerId?: number,
  ): Promise<void> {
    const row = await this.companies.findOne({
      where: { id: companyId },
      select: { id: true, responsible_employee_id: true },
    });
    if (!row) throw new NotFoundException('Company not found.');
    if (ownerId !== undefined && row.responsible_employee_id !== ownerId) {
      throw new ForbiddenException('This company is not assigned to you.');
    }
  }

  // ---- Activity log --------------------------------------------------------

  /** Append one audit entry. Called at the end of every successful mutation. */
  private async logActivity(
    companyId: number,
    actorId: number,
    entityType: ActivityEntityType,
    action: ActivityAction,
    summary: string,
    opts: { entityId?: number | null; changes?: ActivityChange[] | null } = {},
  ): Promise<void> {
    await this.activity.save(
      this.activity.create({
        company_id: companyId,
        employee_id: actorId,
        entity_type: entityType,
        action,
        summary,
        entity_id: opts.entityId ?? null,
        changes: opts.changes ?? null,
      }),
    );
  }

  async listActivity(
    companyId: number,
    query: ActivityQueryDto,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const qb = this.activity
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.employee', 'e')
      .where('a.company_id = :companyId', { companyId });
    if (query.entity_type) {
      qb.andWhere('a.entity_type = :et', { et: query.entity_type });
    }
    qb.orderBy('a.created_at', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((a) => ({
        id: a.id,
        action: a.action,
        entity_type: a.entity_type,
        entity_id: a.entity_id,
        summary: a.summary,
        changes: a.changes,
        actor: a.employee
          ? { id: a.employee.id, name: a.employee.emp_display_name }
          : null,
        created_at: a.created_at,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  // ---- Drives --------------------------------------------------------------

  /**
   * Placement drives raised against one company. Reuses the drive-management
   * list under the corporate-relations grant so a user who can view the company
   * sees its drives without needing the separate drives screen. The officer
   * surface passes `ownerId`, scoping to companies assigned to them.
   *
   * `DrivesService.list` is invoked directly (not through the Nest validation
   * pipe), so the query must carry explicit pagination/sort — the zod DTO's
   * defaults only apply at the controller boundary.
   */
  async listCompanyDrives(companyId: number, ownerId?: number) {
    await this.ensureAccess(companyId, ownerId);
    return this.drives.list({
      company_id: companyId,
      page: 1,
      limit: 100,
      sort_by: 'drive_date',
      sort_dir: 'desc',
    });
  }

  // ---- Companies -----------------------------------------------------------

  async listCompanies(query: CompanyListQueryDto, ownerId?: number) {
    // Build a filter query on `c` alone. Classifier filters are expressed as
    // INNER JOINs, which can multiply rows on M:N relations — so we never
    // getManyAndCount() off this builder directly. Instead we derive a distinct,
    // ordered page of ids and a distinct total, then hydrate those ids.
    const qb = this.companies.createQueryBuilder('c');

    if (ownerId !== undefined) {
      qb.andWhere('c.responsible_employee_id = :ownerId', { ownerId });
    }
    if (query.status === 'active') qb.andWhere('c.is_active = TRUE');
    else if (query.status === 'inactive') qb.andWhere('c.is_active = FALSE');

    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('c.name ILIKE :s', { s: `%${query.search}%` })
            .orWhere('c.short_name ILIKE :s', { s: `%${query.search}%` })
            .orWhere('c.city ILIKE :s', { s: `%${query.search}%` });
        }),
      );
    }

    // Multi-select classifier filters — "company has at least one of these".
    const classifierFilters: Array<[string, number[] | undefined]> = [
      ['categories', query.category_ids],
      ['industries', query.industry_ids],
      ['types', query.type_ids],
      ['sizes', query.size_ids],
      ['sources', query.source_ids],
      ['hiring_modes', query.hiring_mode_ids],
      ['roles', query.role_ids],
      ['tags', query.tag_ids],
      ['eligible_branches', query.eligible_branch_ids],
    ];
    classifierFilters.forEach(([relation, ids], i) => {
      if (ids?.length) {
        const alias = `f_${i}`;
        const param = `fids_${i}`;
        qb.innerJoin(`c.${relation}`, alias, `${alias}.id IN (:...${param})`, {
          [param]: ids,
        });
      }
    });

    // Plain-column filters.
    if (query.tiers?.length)
      qb.andWhere('c.tier IN (:...tiers)', { tiers: query.tiers });
    if (query.relationship_statuses?.length)
      qb.andWhere('c.relationship_status IN (:...rstatuses)', {
        rstatuses: query.relationship_statuses,
      });
    if (query.ownership_types?.length)
      qb.andWhere('c.ownership_type IN (:...otypes)', {
        otypes: query.ownership_types,
      });
    // Responsible-officer filter only applies on the manager (unscoped) surface.
    if (ownerId === undefined && query.responsible_employee_ids?.length)
      qb.andWhere('c.responsible_employee_id IN (:...reids)', {
        reids: query.responsible_employee_ids,
      });
    if (query.offers_internships) qb.andWhere('c.offers_internships = TRUE');
    if (query.offers_ppo) qb.andWhere('c.offers_ppo = TRUE');

    // Distinct total (the joins can duplicate rows; count unique companies).
    const totalRaw = await qb
      .clone()
      .select('COUNT(DISTINCT c.id)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(totalRaw?.cnt ?? 0);

    // Distinct, ordered page of ids. DISTINCT + ORDER BY requires the ordering
    // column in the select list; every sortable column is 1:1 per company so
    // it's safe. `c.id` is a stable tiebreaker so pagination never drifts.
    const sortCol = COMPANY_SORT_COLUMN[query.sort_by];
    const sortDir = query.sort_dir === 'asc' ? 'ASC' : 'DESC';
    const idRows = await qb
      .clone()
      .select('c.id', 'id')
      .addSelect(sortCol, 'sort_val')
      .distinct(true)
      .orderBy(sortCol, sortDir, 'NULLS LAST')
      .addOrderBy('c.id', 'ASC')
      .offset((query.page - 1) * query.limit)
      .limit(query.limit)
      .getRawMany<{ id: number }>();
    const pageIds = idRows.map((r) => Number(r.id));

    if (pageIds.length === 0) {
      return { items: [], total, page: query.page, limit: query.limit };
    }

    // Hydrate the page: officer relation + category/industry chips.
    const [rows, withChips] = await Promise.all([
      this.companies.find({
        where: { id: In(pageIds) },
        relations: { responsible_employee: true },
      }),
      this.companies.find({
        where: { id: In(pageIds) },
        relations: { categories: true, industries: true },
        select: { id: true },
      }),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const catsById = new Map<number, CompanyCategory[]>();
    const indsById = new Map<number, CompanyIndustry[]>();
    for (const c of withChips) {
      catsById.set(c.id, c.categories ?? []);
      indsById.set(c.id, c.industries ?? []);
    }

    // Preserve the ordered page and presign logos (cached → cheap per row).
    const ordered = pageIds
      .map((id) => byId.get(id))
      .filter((c): c is Company => !!c);
    const items = await Promise.all(
      ordered.map(async (c) => ({
        id: c.id,
        name: c.name,
        short_name: c.short_name,
        website: c.website,
        city: c.city,
        relationship_status: c.relationship_status,
        tier: c.tier,
        ownership_type: c.ownership_type,
        package_min: c.package_min,
        package_max: c.package_max,
        offers_internships: c.offers_internships,
        offers_ppo: c.offers_ppo,
        founded_year: c.founded_year,
        is_active: c.is_active,
        last_engaged_on: c.last_engaged_on,
        logo_url: c.logo_key
          ? await this.storage.getCachedReadUrl(c.logo_key)
          : null,
        responsible_employee: c.responsible_employee
          ? {
              id: c.responsible_employee.id,
              name: c.responsible_employee.emp_display_name,
            }
          : null,
        categories: (catsById.get(c.id) ?? []).map(chip),
        industries: (indsById.get(c.id) ?? []).map(chip),
        updated_at: c.updated_at,
      })),
    );

    return { items, total, page: query.page, limit: query.limit };
  }

  async getCompany(companyId: number, ownerId?: number) {
    await this.ensureAccess(companyId, ownerId);
    const company = await this.companies.findOne({
      where: { id: companyId },
      relations: COMPANY_DETAIL_RELATIONS,
      // Load each M:M relation as its own query. With the default 'join'
      // strategy the nine independent junction tables form a cartesian product.
      relationLoadStrategy: 'query',
    });
    if (!company) throw new NotFoundException('Company not found.');
    const contacts = await this.listContacts(companyId);
    return this.mapDetail(company, contacts);
  }

  async createCompany(dto: CreateCompanyDto, employeeId: number) {
    const company = this.companies.create();
    company.name = dto.name;
    company.created_by_employee_id = employeeId;
    this.applyScalars(company, dto);
    this.applyClassifiers(company, dto);
    const saved = await this.companies.save(company);
    await this.logActivity(
      saved.id,
      employeeId,
      'company',
      'created',
      `Created the company "${saved.name}"`,
    );
    return this.getCompany(saved.id);
  }

  async updateCompany(
    companyId: number,
    dto: UpdateCompanyDto,
    actorId: number,
  ) {
    const company = await this.companies.findOne({
      where: { id: companyId },
      relations: COMPANY_DETAIL_RELATIONS,
      // Per-relation queries — same cartesian-join avoidance as getCompany.
      relationLoadStrategy: 'query',
    });
    if (!company) throw new NotFoundException('Company not found.');

    // Snapshot tracked scalar + classifier state before applying the edit.
    const before = this.snapshotCompany(company);
    const beforeOfficer = company.responsible_employee
      ? company.responsible_employee.emp_display_name
      : null;

    if (dto.name !== undefined) company.name = dto.name;
    this.applyScalars(company, dto);
    this.applyClassifiers(company, dto);
    await this.companies.save(company);

    await this.logCompanyEdit(
      companyId,
      actorId,
      dto,
      company,
      before,
      beforeOfficer,
    );
    return this.getCompany(companyId);
  }

  /**
   * Officer-surface edit: scoped to the acting officer's own company, and with
   * the identity/ownership fields stripped — an officer may edit descriptive
   * company fields but NOT rename the company or reassign the responsible
   * officer (which would remove their own access). Enforced server-side; the
   * officer form never renders those controls.
   */
  async updateCompanyAsOfficer(
    companyId: number,
    dto: UpdateCompanyDto,
    actorId: number,
  ) {
    await this.ensureAccess(companyId, actorId);
    const { name: _name, responsible_employee_id: _resp, ...rest } = dto;
    return this.updateCompany(companyId, rest, actorId);
  }

  async setCompanyStatus(
    companyId: number,
    isActive: boolean,
    actorId: number,
  ) {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found.');
    company.is_active = isActive;
    await this.companies.save(company);
    await this.logActivity(
      companyId,
      actorId,
      'company',
      'status_changed',
      isActive ? 'Activated the company' : 'Deactivated the company',
    );
    return this.getCompany(companyId);
  }

  async setLogo(
    companyId: number,
    file: { buffer: Buffer; mimetype: string },
    actorId: number,
  ) {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found.');
    const key = storageKey.companyLogo(companyId);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    company.logo_key = key;
    await this.companies.save(company);
    await this.logActivity(
      companyId,
      actorId,
      'company',
      'logo_updated',
      'Updated the company logo',
    );
    return { logo_url: await this.storage.getCachedReadUrl(key) };
  }

  /** Active employees for the responsible-officer picker. */
  async assignableEmployees() {
    const rows = await this.employees.find({
      where: { is_active: true },
      select: { id: true, emp_code: true, emp_display_name: true },
      order: { emp_display_name: 'ASC' },
    });
    return rows.map((e) => ({
      id: e.id,
      emp_code: e.emp_code,
      name: e.emp_display_name,
    }));
  }

  /** Lookups + departments + fixed enums for the company create/edit form. */
  async formOptions() {
    const lookups = await this.attributes.activeByKind();
    const depts = await this.departments.find({
      where: { is_active: true },
      select: { id: true, name: true, short_name: true },
      order: { name: 'ASC' },
    });
    return {
      categories: lookups.categories.map(chip),
      industries: lookups.industries.map(chip),
      types: lookups.types.map(chip),
      sizes: lookups.sizes.map(chip),
      sources: lookups.sources.map(chip),
      hiring_modes: lookups['hiring-modes'].map(chip),
      roles: lookups.roles.map(chip),
      tags: lookups.tags.map(chip),
      departments: depts.map((d) => ({
        id: d.id,
        name: d.name,
        short_name: d.short_name,
      })),
      ownership_types: OWNERSHIP_TYPES,
      tiers: COMPANY_TIERS,
      relationship_statuses: RELATIONSHIP_STATUSES,
      interaction_types: INTERACTION_TYPES,
      milestone_types: MILESTONE_TYPES,
    };
  }

  // ---- Contacts ------------------------------------------------------------

  async listContacts(companyId: number, ownerId?: number) {
    if (ownerId !== undefined) await this.ensureAccess(companyId, ownerId);
    const rows = await this.contacts.find({
      where: { company_id: companyId },
      order: { is_primary: 'DESC', name: 'ASC' },
    });
    return rows;
  }

  async createContact(
    companyId: number,
    dto: ContactDto,
    actorId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    if (dto.is_primary) {
      await this.contacts.update(
        { company_id: companyId, is_primary: true },
        { is_primary: false },
      );
    }
    const row = this.contacts.create({ ...dto, company_id: companyId });
    const saved = await this.contacts.save(row);
    await this.logActivity(
      companyId,
      actorId,
      'contact',
      'created',
      `Added contact "${saved.name}"`,
      { entityId: saved.id },
    );
    return saved;
  }

  async updateContact(
    companyId: number,
    contactId: number,
    dto: UpdateContactDto,
    actorId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.contacts.findOne({
      where: { id: contactId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Contact not found.');
    if (dto.is_primary) {
      await this.contacts.update(
        { company_id: companyId, is_primary: true },
        { is_primary: false },
      );
    }
    Object.assign(row, dto);
    const saved = await this.contacts.save(row);
    await this.logActivity(
      companyId,
      actorId,
      'contact',
      'updated',
      `Updated contact "${saved.name}"`,
      { entityId: saved.id },
    );
    return saved;
  }

  async deleteContact(
    companyId: number,
    contactId: number,
    actorId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.contacts.findOne({
      where: { id: contactId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Contact not found.');
    await this.contacts.remove(row);
    await this.logActivity(
      companyId,
      actorId,
      'contact',
      'deleted',
      `Removed contact "${row.name}"`,
    );
    return { deleted: true };
  }

  // ---- Interactions --------------------------------------------------------

  async listInteractions(
    companyId: number,
    query: InteractionQueryDto,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const qb = this.interactions
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.employee', 'e')
      .leftJoinAndSelect('i.contact', 'ct')
      .where('i.company_id = :companyId', { companyId });
    if (query.year) {
      qb.andWhere('EXTRACT(YEAR FROM i.interaction_date) = :year', {
        year: query.year,
      });
    }
    if (query.month) {
      qb.andWhere('EXTRACT(MONTH FROM i.interaction_date) = :month', {
        month: query.month,
      });
    }
    qb.orderBy('i.interaction_date', 'DESC').addOrderBy('i.id', 'DESC');
    const rows = await qb.getMany();
    return rows.map((i) => ({
      id: i.id,
      type: i.type,
      interaction_date: i.interaction_date,
      summary: i.summary,
      follow_up_date: i.follow_up_date,
      outcome: i.outcome,
      contact: i.contact ? { id: i.contact.id, name: i.contact.name } : null,
      logged_by: i.employee
        ? { id: i.employee.id, name: i.employee.emp_display_name }
        : null,
      created_at: i.created_at,
    }));
  }

  async createInteraction(
    companyId: number,
    dto: InteractionDto,
    employeeId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = this.interactions.create({
      ...dto,
      company_id: companyId,
      employee_id: employeeId,
    });
    const saved = await this.interactions.save(row);
    await this.touchLastEngaged(companyId, dto.interaction_date);
    await this.logActivity(
      companyId,
      employeeId,
      'interaction',
      'created',
      `Logged a ${humanize(dto.type)} interaction on ${dto.interaction_date}`,
      { entityId: saved.id },
    );
    return saved;
  }

  async updateInteraction(
    companyId: number,
    interactionId: number,
    dto: UpdateInteractionDto,
    actorId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.interactions.findOne({
      where: { id: interactionId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Interaction not found.');
    Object.assign(row, dto);
    const saved = await this.interactions.save(row);
    await this.logActivity(
      companyId,
      actorId,
      'interaction',
      'updated',
      `Updated a ${humanize(saved.type)} interaction`,
      { entityId: saved.id },
    );
    return saved;
  }

  async deleteInteraction(
    companyId: number,
    interactionId: number,
    actorId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.interactions.findOne({
      where: { id: interactionId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Interaction not found.');
    await this.interactions.remove(row);
    await this.logActivity(
      companyId,
      actorId,
      'interaction',
      'deleted',
      `Deleted a ${humanize(row.type)} interaction`,
    );
    return { deleted: true };
  }

  // ---- Relationship milestones ---------------------------------------------

  async listMilestones(companyId: number, ownerId?: number) {
    await this.ensureAccess(companyId, ownerId);
    const rows = await this.milestones.find({
      where: { company_id: companyId },
      relations: { employee: true },
      order: { milestone_date: 'DESC', id: 'DESC' },
    });
    return rows.map((m) => ({
      id: m.id,
      milestone_date: m.milestone_date,
      type: m.type,
      title: m.title,
      summary: m.summary,
      logged_by: m.employee
        ? { id: m.employee.id, name: m.employee.emp_display_name }
        : null,
      created_at: m.created_at,
    }));
  }

  async createMilestone(
    companyId: number,
    dto: MilestoneDto,
    employeeId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = this.milestones.create({
      ...dto,
      company_id: companyId,
      employee_id: employeeId,
    });
    const saved = await this.milestones.save(row);
    await this.logActivity(
      companyId,
      employeeId,
      'milestone',
      'created',
      `Added milestone "${saved.title}"`,
      { entityId: saved.id },
    );
    return saved;
  }

  async deleteMilestone(
    companyId: number,
    milestoneId: number,
    actorId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.milestones.findOne({
      where: { id: milestoneId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Milestone not found.');
    await this.milestones.remove(row);
    await this.logActivity(
      companyId,
      actorId,
      'milestone',
      'deleted',
      `Removed milestone "${row.title}"`,
    );
    return { deleted: true };
  }

  // ---- Helpers -------------------------------------------------------------

  private async touchLastEngaged(companyId: number, date: string) {
    await this.companies
      .createQueryBuilder()
      .update(Company)
      .set({
        last_engaged_on: () =>
          `GREATEST(COALESCE(last_engaged_on, '0001-01-01'), '${date}')`,
      })
      .where('id = :companyId', { companyId })
      .execute();
  }

  /** Copy the optional scalar company fields present in the DTO. */
  private applyScalars(company: Company, dto: UpdateCompanyDto) {
    const strKeys = [
      'short_name',
      'website',
      'linkedin_url',
      'description',
      'general_email',
      'general_phone',
      'ownership_type',
      'tier',
      'gstin',
      'cin',
      'pan',
      'registration_number',
      'partnership_since',
      'address_line1',
      'address_line2',
      'city',
      'state',
      'country',
      'pincode',
    ] as const;
    const target = company as unknown as Record<string, unknown>;
    for (const k of strKeys) {
      if (k in dto) target[k] = dto[k] ?? null;
    }
    if ('relationship_status' in dto && dto.relationship_status) {
      company.relationship_status = dto.relationship_status;
    }
    if ('founded_year' in dto) company.founded_year = dto.founded_year ?? null;
    if ('glassdoor_rating' in dto) {
      company.glassdoor_rating =
        dto.glassdoor_rating == null ? null : String(dto.glassdoor_rating);
    }
    if ('package_min' in dto) {
      company.package_min =
        dto.package_min == null ? null : String(dto.package_min);
    }
    if ('package_max' in dto) {
      company.package_max =
        dto.package_max == null ? null : String(dto.package_max);
    }
    if ('offers_internships' in dto && dto.offers_internships !== undefined) {
      company.offers_internships = dto.offers_internships;
    }
    if ('offers_ppo' in dto && dto.offers_ppo !== undefined) {
      company.offers_ppo = dto.offers_ppo;
    }
    if ('responsible_employee_id' in dto) {
      company.responsible_employee_id = dto.responsible_employee_id ?? null;
      // updateCompany loads the entity WITH the responsible_employee relation
      // populated. On save() TypeORM derives the FK from the loaded relation
      // object, not the scalar — so setting only the scalar above is silently
      // overwritten with the old officer. Reassign the relation as an id-ref
      // (mirrors the classifier pattern) so the new officer actually persists.
      company.responsible_employee = dto.responsible_employee_id
        ? ({ id: dto.responsible_employee_id } as Employee)
        : null;
    }
  }

  /** Reconcile the multi-select join tables from the DTO's id arrays. */
  private applyClassifiers(company: Company, dto: UpdateCompanyDto) {
    if (dto.category_ids !== undefined)
      company.categories = asRefs(dto.category_ids) as CompanyCategory[];
    if (dto.industry_ids !== undefined)
      company.industries = asRefs(dto.industry_ids) as CompanyIndustry[];
    if (dto.type_ids !== undefined)
      company.types = asRefs(dto.type_ids) as CompanyType[];
    if (dto.size_ids !== undefined)
      company.sizes = asRefs(dto.size_ids) as CompanySize[];
    if (dto.source_ids !== undefined)
      company.sources = asRefs(dto.source_ids) as CompanySource[];
    if (dto.hiring_mode_ids !== undefined)
      company.hiring_modes = asRefs(dto.hiring_mode_ids) as CompanyHiringMode[];
    if (dto.role_ids !== undefined)
      company.roles = asRefs(dto.role_ids) as CompanyRole[];
    if (dto.tag_ids !== undefined)
      company.tags = asRefs(dto.tag_ids) as CompanyTag[];
    if (dto.eligible_branch_ids !== undefined)
      company.eligible_branches = asRefs(
        dto.eligible_branch_ids,
      ) as Department[];
  }

  /** Capture the tracked scalar + classifier + relationship state for diffing. */
  private snapshotCompany(company: Company) {
    const scalars: Record<string, unknown> = {};
    for (const key of Object.keys(TRACKED_COMPANY_FIELDS)) {
      scalars[key] = (company as unknown as Record<string, unknown>)[key];
    }
    const classifiers: Record<string, number[]> = {};
    for (const rel of Object.keys(CLASSIFIER_FIELDS)) {
      const arr = (company as unknown as Record<string, { id: number }[]>)[rel];
      classifiers[rel] = (arr ?? []).map((x) => x.id).sort((a, b) => a - b);
    }
    return {
      scalars,
      classifiers,
      relationship_status: company.relationship_status,
      responsible_employee_id: company.responsible_employee_id,
    };
  }

  /** Diff a company edit into one or more audit entries. */
  private async logCompanyEdit(
    companyId: number,
    actorId: number,
    dto: UpdateCompanyDto,
    after: Company,
    before: ReturnType<CorporateRelationsService['snapshotCompany']>,
    beforeOfficerName: string | null,
  ): Promise<void> {
    const eq = (a: unknown, b: unknown) => {
      const na = a === undefined ? null : a;
      const nb = b === undefined ? null : b;
      if (na === null && nb === null) return true;
      return String(na) === String(nb);
    };
    const afterRec = after as unknown as Record<string, unknown>;

    // 1. Relationship status → its own status_changed entry.
    if (!eq(before.relationship_status, after.relationship_status)) {
      await this.logActivity(
        companyId,
        actorId,
        'company',
        'status_changed',
        `Changed relationship status from ${humanize(
          before.relationship_status,
        )} to ${humanize(after.relationship_status)}`,
      );
    }

    // 2. Responsible-officer reassignment → assigned entry (resolve names).
    if (!eq(before.responsible_employee_id, after.responsible_employee_id)) {
      const toName = after.responsible_employee_id
        ? ((
            await this.employees.findOne({
              where: { id: after.responsible_employee_id },
              select: { id: true, emp_display_name: true },
            })
          )?.emp_display_name ?? null)
        : null;
      const summary = !toName
        ? `Unassigned the responsible officer${
            beforeOfficerName ? ` (was ${beforeOfficerName})` : ''
          }`
        : beforeOfficerName
          ? `Reassigned responsible officer from ${beforeOfficerName} to ${toName}`
          : `Assigned ${toName} as responsible officer`;
      await this.logActivity(
        companyId,
        actorId,
        'company',
        'assigned',
        summary,
      );
    }

    // 3. Remaining tracked scalar edits → one "Updated details" entry.
    const changes: ActivityChange[] = [];
    for (const [key, label] of Object.entries(TRACKED_COMPANY_FIELDS)) {
      if (eq(before.scalars[key], afterRec[key])) continue;
      changes.push({
        field: label,
        from: before.scalars[key],
        to: afterRec[key],
      });
    }
    if (changes.length) {
      await this.logActivity(
        companyId,
        actorId,
        'company',
        'updated',
        'Updated company details',
        { changes },
      );
    }

    // 4. Classifier (multi-select) list changes → one coarse entry.
    let classifiersChanged = false;
    for (const [rel, dtoKey] of Object.entries(CLASSIFIER_FIELDS)) {
      if (dto[dtoKey] === undefined) continue;
      const afterIds = ((afterRec[rel] as { id: number }[] | undefined) ?? [])
        .map((x) => x.id)
        .sort((a, b) => a - b);
      if (before.classifiers[rel].join(',') !== afterIds.join(',')) {
        classifiersChanged = true;
        break;
      }
    }
    if (classifiersChanged) {
      await this.logActivity(
        companyId,
        actorId,
        'company',
        'updated',
        'Updated company classifiers',
      );
    }
  }

  private async mapDetail(company: Company, contacts: CompanyContact[]) {
    return {
      id: company.id,
      name: company.name,
      short_name: company.short_name,
      website: company.website,
      linkedin_url: company.linkedin_url,
      description: company.description,
      logo_url: company.logo_key
        ? await this.storage.getCachedReadUrl(company.logo_key)
        : null,
      founded_year: company.founded_year,
      glassdoor_rating: company.glassdoor_rating,
      general_email: company.general_email,
      general_phone: company.general_phone,
      ownership_type: company.ownership_type,
      tier: company.tier,
      gstin: company.gstin,
      cin: company.cin,
      pan: company.pan,
      registration_number: company.registration_number,
      package_min: company.package_min,
      package_max: company.package_max,
      offers_internships: company.offers_internships,
      offers_ppo: company.offers_ppo,
      last_engaged_on: company.last_engaged_on,
      relationship_status: company.relationship_status,
      partnership_since: company.partnership_since,
      address_line1: company.address_line1,
      address_line2: company.address_line2,
      city: company.city,
      state: company.state,
      country: company.country,
      pincode: company.pincode,
      is_active: company.is_active,
      responsible_employee: company.responsible_employee
        ? {
            id: company.responsible_employee.id,
            emp_code: company.responsible_employee.emp_code,
            name: company.responsible_employee.emp_display_name,
          }
        : null,
      categories: (company.categories ?? []).map(chip),
      industries: (company.industries ?? []).map(chip),
      types: (company.types ?? []).map(chip),
      sizes: (company.sizes ?? []).map(chip),
      sources: (company.sources ?? []).map(chip),
      hiring_modes: (company.hiring_modes ?? []).map(chip),
      roles: (company.roles ?? []).map(chip),
      tags: (company.tags ?? []).map(chip),
      eligible_branches: (company.eligible_branches ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        short_name: d.short_name,
      })),
      contacts,
      created_at: company.created_at,
      updated_at: company.updated_at,
    };
  }
}
