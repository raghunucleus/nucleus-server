import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Brackets, In, Repository } from 'typeorm';
import { Department } from '../../admin/entities/department.entity';
import { Employee } from '../../admin/entities/employee.entity';
import { StorageService } from '../../storage/storage.service';
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
  ContactDto,
  InteractionDto,
  InteractionQueryDto,
  MilestoneDto,
  UpdateContactDto,
  UpdateInteractionDto,
} from './dto/activity.dto';
import {
  CompanyListQueryDto,
  CreateCompanyDto,
  UpdateCompanyDto,
} from './dto/company.dto';

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

const asRefs = (ids?: number[]) => (ids ? ids.map((id) => ({ id })) : undefined);
const chip = (r: { id: number; name: string }) => ({ id: r.id, name: r.name });

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
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    private readonly attributes: CompanyAttributesService,
    private readonly storage: StorageService,
  ) {}

  // ---- Ownership -----------------------------------------------------------

  /**
   * Guard for the officer surface: the acting employee must be the company's
   * single responsible officer. Also asserts the company exists. When
   * `ownerId` is undefined (manager surface) only existence is checked.
   */
  private async ensureAccess(companyId: number, ownerId?: number): Promise<void> {
    const row = await this.companies.findOne({
      where: { id: companyId },
      select: { id: true, responsible_employee_id: true },
    });
    if (!row) throw new NotFoundException('Company not found.');
    if (ownerId !== undefined && row.responsible_employee_id !== ownerId) {
      throw new ForbiddenException('This company is not assigned to you.');
    }
  }

  // ---- Companies -----------------------------------------------------------

  async listCompanies(query: CompanyListQueryDto, ownerId?: number) {
    const qb = this.companies
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.responsible_employee', 're');

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
    if (query.category_id) {
      qb.innerJoin('c.categories', 'fcat', 'fcat.id = :catId', {
        catId: query.category_id,
      });
    }
    if (query.industry_id) {
      qb.innerJoin('c.industries', 'find', 'find.id = :indId', {
        indId: query.industry_id,
      });
    }
    if (ownerId === undefined && query.responsible_employee_id) {
      qb.andWhere('c.responsible_employee_id = :rid', {
        rid: query.responsible_employee_id,
      });
    }

    qb.orderBy('c.updated_at', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit);

    const [rows, total] = await qb.getManyAndCount();

    // Load category chips for the page in one extra query (safe with paging).
    const ids = rows.map((r) => r.id);
    const catsById = new Map<number, CompanyCategory[]>();
    if (ids.length) {
      const withCats = await this.companies.find({
        where: { id: In(ids) },
        relations: { categories: true },
        select: { id: true },
      });
      for (const c of withCats) catsById.set(c.id, c.categories ?? []);
    }

    return {
      items: rows.map((c) => ({
        id: c.id,
        name: c.name,
        short_name: c.short_name,
        city: c.city,
        relationship_status: c.relationship_status,
        tier: c.tier,
        is_active: c.is_active,
        last_engaged_on: c.last_engaged_on,
        responsible_employee: c.responsible_employee
          ? {
              id: c.responsible_employee.id,
              name: c.responsible_employee.emp_display_name,
            }
          : null,
        categories: (catsById.get(c.id) ?? []).map(chip),
        updated_at: c.updated_at,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getCompany(companyId: number, ownerId?: number) {
    await this.ensureAccess(companyId, ownerId);
    const company = await this.companies.findOne({
      where: { id: companyId },
      relations: COMPANY_DETAIL_RELATIONS,
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
    return this.getCompany(saved.id);
  }

  async updateCompany(companyId: number, dto: UpdateCompanyDto) {
    const company = await this.companies.findOne({
      where: { id: companyId },
      relations: COMPANY_DETAIL_RELATIONS,
    });
    if (!company) throw new NotFoundException('Company not found.');
    if (dto.name !== undefined) company.name = dto.name;
    this.applyScalars(company, dto);
    this.applyClassifiers(company, dto);
    await this.companies.save(company);
    return this.getCompany(companyId);
  }

  async setCompanyStatus(companyId: number, isActive: boolean) {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found.');
    company.is_active = isActive;
    await this.companies.save(company);
    return this.getCompany(companyId);
  }

  async setLogo(
    companyId: number,
    file: { buffer: Buffer; mimetype: string },
  ) {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found.');
    const key = `companies/${companyId}/logo/${randomUUID()}`;
    await this.storage.putObject(key, file.buffer, file.mimetype);
    company.logo_key = key;
    await this.companies.save(company);
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

  async createContact(companyId: number, dto: ContactDto, ownerId?: number) {
    await this.ensureAccess(companyId, ownerId);
    if (dto.is_primary) {
      await this.contacts.update(
        { company_id: companyId, is_primary: true },
        { is_primary: false },
      );
    }
    const row = this.contacts.create({ ...dto, company_id: companyId });
    return this.contacts.save(row);
  }

  async updateContact(
    companyId: number,
    contactId: number,
    dto: UpdateContactDto,
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
    return this.contacts.save(row);
  }

  async deleteContact(companyId: number, contactId: number, ownerId?: number) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.contacts.findOne({
      where: { id: contactId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Contact not found.');
    await this.contacts.remove(row);
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
    return saved;
  }

  async updateInteraction(
    companyId: number,
    interactionId: number,
    dto: UpdateInteractionDto,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.interactions.findOne({
      where: { id: interactionId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Interaction not found.');
    Object.assign(row, dto);
    return this.interactions.save(row);
  }

  async deleteInteraction(
    companyId: number,
    interactionId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.interactions.findOne({
      where: { id: interactionId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Interaction not found.');
    await this.interactions.remove(row);
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
    return this.milestones.save(row);
  }

  async deleteMilestone(
    companyId: number,
    milestoneId: number,
    ownerId?: number,
  ) {
    await this.ensureAccess(companyId, ownerId);
    const row = await this.milestones.findOne({
      where: { id: milestoneId, company_id: companyId },
    });
    if (!row) throw new NotFoundException('Milestone not found.');
    await this.milestones.remove(row);
    return { deleted: true };
  }

  // ---- Helpers -------------------------------------------------------------

  private async touchLastEngaged(companyId: number, date: string) {
    await this.companies
      .createQueryBuilder()
      .update(Company)
      .set({ last_engaged_on: () => `GREATEST(COALESCE(last_engaged_on, '0001-01-01'), '${date}')` })
      .where('id = :companyId', { companyId })
      .execute();
  }

  /** Copy the optional scalar company fields present in the DTO. */
  private applyScalars(company: Company, dto: UpdateCompanyDto) {
    const strKeys = [
      'short_name', 'website', 'linkedin_url', 'description', 'general_email',
      'general_phone', 'ownership_type', 'tier', 'gstin', 'cin', 'pan',
      'registration_number', 'partnership_since', 'address_line1',
      'address_line2', 'city', 'state', 'country', 'pincode',
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
      company.package_min = dto.package_min == null ? null : String(dto.package_min);
    }
    if ('package_max' in dto) {
      company.package_max = dto.package_max == null ? null : String(dto.package_max);
    }
    if ('offers_internships' in dto && dto.offers_internships !== undefined) {
      company.offers_internships = dto.offers_internships;
    }
    if ('offers_ppo' in dto && dto.offers_ppo !== undefined) {
      company.offers_ppo = dto.offers_ppo;
    }
    if ('responsible_employee_id' in dto) {
      company.responsible_employee_id = dto.responsible_employee_id ?? null;
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
      company.eligible_branches = asRefs(dto.eligible_branch_ids) as Department[];
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
