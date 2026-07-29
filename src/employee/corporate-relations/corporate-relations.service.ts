import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { StorageService } from '../../storage/storage.service';
import { storageKey } from '../../storage/storage.constants';
import { CompanyApprovalService } from './company-approval.service';
import { CompanyAttributesService } from './company-attributes.service';
import { companyChromeFor, openRequest } from './company-chrome';
import { Company } from './entities/company.entity';
import { CompanyCategory } from './entities/company-lookups.entity';
import { CompanyJobRole } from './entities/company-job-role.entity';
import {
  COMPANY_SORT_FIELDS,
  CompanyListQueryDto,
  CreateCompanyDto,
  UpdateCompanyDto,
} from './dto/company.dto';
import { MyJobRoleListQueryDto } from './dto/job-role.dto';

/** Maps whitelisted sort keys to their DISTINCT-safe scalar column on `c`. */
const COMPANY_SORT_COLUMN: Record<
  (typeof COMPANY_SORT_FIELDS)[number],
  string
> = {
  name: 'c.name',
  updated_at: 'c.updated_at',
};

const asRefs = (ids?: number[]) =>
  ids ? ids.map((id) => ({ id })) : undefined;
const chip = (r: { id: number; name: string }) => ({ id: r.id, name: r.name });

const mapRoles = (c: Company) =>
  (c.job_roles ?? [])
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      id: r.id,
      role_name: r.role_name,
      responsible_employee: r.responsible_employee
        ? {
            id: r.responsible_employee.id,
            emp_code: r.responsible_employee.emp_code,
            emp_display_name: r.responsible_employee.emp_display_name,
          }
        : null,
    }));

@Injectable()
export class CorporateRelationsService {
  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(CompanyJobRole)
    private readonly jobRoles: Repository<CompanyJobRole>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    private readonly attributes: CompanyAttributesService,
    private readonly approvals: CompanyApprovalService,
    private readonly storage: StorageService,
  ) {}

  async listCompanies(query: CompanyListQueryDto) {
    // Build a filter query on `c` alone. The category filter is an INNER JOIN,
    // which can multiply rows on an M:N relation — so we never
    // getManyAndCount() off this builder directly. Instead we derive a distinct,
    // ordered page of ids and a distinct total, then hydrate those ids.
    const qb = this.companies.createQueryBuilder('c');

    if (query.status === 'active') qb.andWhere('c.is_active = TRUE');
    else if (query.status === 'inactive') qb.andWhere('c.is_active = FALSE');
    else if (query.status === 'pending') qb.andWhere('c.is_active IS NULL');

    if (query.approval !== 'all') {
      qb.andWhere('c.approval_status = :ap', { ap: query.approval });
    }

    if (query.search) {
      qb.andWhere('c.name ILIKE :s', { s: `%${query.search}%` });
    }

    // "Company has at least one of these categories."
    if (query.category_ids?.length) {
      qb.innerJoin('c.categories', 'f_cat', 'f_cat.id IN (:...catIds)', {
        catIds: query.category_ids,
      });
    }

    // Distinct total (the join can duplicate rows; count unique companies).
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

    const rows = await this.companies.find({
      where: { id: In(pageIds) },
      relations: {
        categories: true,
        job_roles: { responsible_employee: true },
      },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    // One query for the whole page — a "change pending" flag must never go
    // N+1 over the rows.
    const openRequests = await this.approvals.openRequestsForCompanies(pageIds);

    // Preserve the ordered page and presign logos (cached → cheap per row).
    const ordered = pageIds
      .map((id) => byId.get(id))
      .filter((c): c is Company => !!c);
    const items = await Promise.all(
      ordered.map(async (c) => ({
        id: c.id,
        name: c.name,
        website: c.website,
        approval_status: c.approval_status,
        is_active: c.is_active,
        logo_url: c.logo_key
          ? await this.storage.getCachedReadUrl(c.logo_key)
          : null,
        categories: (c.categories ?? []).map(chip),
        roles: mapRoles(c),
        open_request: openRequest(openRequests.get(c.id)),
        updated_at: c.updated_at,
      })),
    );

    return { items, total, page: query.page, limit: query.limit };
  }

  async getCompany(companyId: number) {
    const company = await this.companies.findOne({
      where: { id: companyId },
      relations: {
        categories: true,
        job_roles: { responsible_employee: true },
      },
    });
    if (!company) throw new NotFoundException('Company not found.');
    return this.mapDetail(company);
  }

  /**
   * The job roles ONE employee is accountable for, with the company each
   * belongs to — the Roles or Designations screen.
   *
   * Scoped to the caller by `responsible_employee_id`, which comes from the
   * token and never from the request. Unpaginated by design (see the DTO): the
   * screen groups by company, and a page boundary would split a company's roles.
   */
  async listMyJobRoles(employeeId: number, query: MyJobRoleListQueryDto) {
    const qb = this.jobRoles
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.company', 'c')
      .leftJoinAndSelect('c.categories', 'cat')
      .where('r.responsible_employee_id = :me', { me: employeeId });

    if (query.search) {
      qb.andWhere('(c.name ILIKE :s OR r.role_name ILIKE :s)', {
        s: `%${query.search}%`,
      });
    }

    const rows = await qb
      .orderBy('c.name', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .getMany();

    // Several roles can share a company — the open-request flag and the
    // presigned logo are resolved once per company, never once per row.
    const chrome = await companyChromeFor(
      [...new Map(rows.map((r) => [r.company_id, r.company])).values()],
      this.storage,
      this.approvals,
    );

    return rows.map((r) => ({
      id: r.id,
      role_name: r.role_name,
      company: {
        id: r.company.id,
        name: r.company.name,
        website: r.company.website,
        logo_url: chrome.get(r.company_id)?.logo_url ?? null,
        approval_status: r.company.approval_status,
        is_active: r.company.is_active,
        // Lets the screen offer "edit and resubmit" on the caller's own draft
        // and nothing else — the same rule `assertOwnDraftCompany` enforces.
        created_by_employee_id: r.company.created_by_employee_id,
        categories: (r.company.categories ?? []).map(chip),
        open_request: chrome.get(r.company_id)?.open_request ?? null,
      },
      updated_at: r.updated_at,
    }));
  }

  /**
   * Guard for the Roles or Designations screen's READ endpoints: the caller may
   * only open a company they are accountable for a role on — the ones already
   * on their list — or one they created themselves. The second clause matters
   * for the send-back path: someone can create a company and assign every role
   * to a colleague, and still has to be able to resubmit it.
   *
   * 404s rather than 403s, so the screen can't be used to probe the catalog.
   */
  async assertCompanyVisibleToOwner(companyId: number, employeeId: number) {
    const [company, ownedRoles] = await Promise.all([
      this.companies.findOne({
        where: { id: companyId },
        select: { id: true, created_by_employee_id: true },
      }),
      this.jobRoles.count({
        where: { company_id: companyId, responsible_employee_id: employeeId },
      }),
    ]);
    if (
      !company ||
      (ownedRoles === 0 && company.created_by_employee_id !== employeeId)
    ) {
      throw new NotFoundException('Company not found.');
    }
  }

  /**
   * Guard for the Roles or Designations screen's WRITE endpoints: it may only
   * touch a company the caller created that is NOT live yet — the draft they
   * just added, never the catalog. Anything else 404s rather than 403s, so the
   * screen can't be used to probe which companies exist.
   */
  async assertOwnDraftCompany(companyId: number, employeeId: number) {
    const company = await this.companies.findOne({
      where: { id: companyId },
      select: { id: true, created_by_employee_id: true, approval_status: true },
    });
    if (
      !company ||
      company.created_by_employee_id !== employeeId ||
      company.approval_status === 'approved'
    ) {
      throw new NotFoundException('Company not found.');
    }
  }

  /**
   * Create the company and send it for approval.
   *
   * Two steps by necessity: the request payload references the company id, so
   * the row has to exist first. If the second step fails the company is left
   * `pending` with no open request — not a dead end, that is exactly the draft
   * state the form's "pending, no open request" branch re-raises from.
   */
  async createCompany(dto: CreateCompanyDto, employeeId: number) {
    const company = this.companies.create();
    company.name = dto.name;
    company.website = dto.website ?? null;
    company.logo_key = dto.logo_key ?? null;
    company.created_by_employee_id = employeeId;
    company.approval_status = 'pending';
    company.is_active = null;
    company.categories = asRefs(dto.category_ids) as CompanyCategory[];
    const saved = await this.companies.save(company);

    // The roles land on the row straight away: the company isn't live, so
    // there is nothing to protect, and the approver edits them on the request.
    await this.writeRoles(saved.id, dto.roles);

    await this.approvals.raise(employeeId, saved.id, 'create', dto);
    return this.getCompany(saved.id);
  }

  /**
   * Edit a company. What that means depends on whether it is live:
   *  - `pending`/`rejected` — not in the catalog, so the row is written
   *    directly and a fresh request raised (or the sent-back one resubmitted).
   *  - `approved` — the row is NOT touched. The whole proposal is staged on an
   *    approval request and only written when someone approves it.
   */
  async updateCompany(
    companyId: number,
    dto: UpdateCompanyDto,
    employeeId: number,
  ) {
    const company = await this.companies.findOne({
      where: { id: companyId },
      relations: { categories: true },
    });
    if (!company) throw new NotFoundException('Company not found.');

    const open = await this.approvals.openRequestFor(companyId);
    if (open?.status === 'pending') {
      throw new ConflictException(
        'This company already has a change awaiting approval. Cancel that request or wait for a decision.',
      );
    }

    if (company.approval_status === 'approved') {
      // Staged only — the live company keeps its current details.
      if (open?.status === 'sent_back') {
        await this.approvals.resubmit(
          employeeId,
          open.id,
          companyId,
          'update',
          dto,
        );
      } else {
        await this.approvals.raise(employeeId, companyId, 'update', dto);
      }
      return this.getCompany(companyId);
    }

    if (dto.name !== undefined) company.name = dto.name;
    if ('website' in dto) company.website = dto.website ?? null;
    if ('logo_key' in dto) company.logo_key = dto.logo_key ?? null;
    if (dto.category_ids !== undefined) {
      company.categories = asRefs(dto.category_ids) as CompanyCategory[];
    }
    await this.companies.save(company);
    await this.writeRoles(companyId, dto.roles);

    if (open?.status === 'sent_back') {
      await this.approvals.resubmit(
        employeeId,
        open.id,
        companyId,
        'create',
        dto,
      );
    } else {
      await this.approvals.raise(employeeId, companyId, 'create', dto);
    }
    return this.getCompany(companyId);
  }

  /** The company's open approval request, or null. See `requestForCompany`. */
  async getCompanyRequest(companyId: number, employeeId: number) {
    const company = await this.companies.findOne({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found.');
    return this.approvals.requestForCompany(companyId, employeeId);
  }

  /**
   * Upload a logo. For a company that isn't live yet the key lands on the row
   * immediately; for an approved one it is only STAGED — the caller puts the
   * returned `logo_key` in the edit payload and it is applied on approval, the
   * same as every other field.
   *
   * `storageKey.companyLogo` mints a fresh uuid key per upload, so the two
   * cases can share one object space with no copying; the loser is deleted
   * when the request is decided.
   */
  async setLogo(companyId: number, file: { buffer: Buffer; mimetype: string }) {
    const company = await this.companies.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found.');

    const key = storageKey.companyLogo(companyId);
    await this.storage.putObject(key, file.buffer, file.mimetype);
    const logo_url = await this.storage.getCachedReadUrl(key);

    if (company.approval_status === 'approved') {
      return { logo_key: key, logo_url, staged: true };
    }

    const previous = company.logo_key;
    company.logo_key = key;
    await this.companies.save(company);
    // A new company's request was filed before this upload could happen, so the
    // payload still snapshots the old (usually null) key. Fold the new one in,
    // or approval writes that stale key straight back over the row.
    await this.approvals.syncLogoKey(companyId, key);
    // The replaced object has no pointer left — drop it rather than leak it.
    if (previous && previous !== key) void this.storage.deleteObject(previous);
    return { logo_key: key, logo_url, staged: false };
  }

  /** Lookups for the company form, plus the caller (the default role owner). */
  async formOptions(employee: { id: number }) {
    const [lookups, me] = await Promise.all([
      this.attributes.activeByKind(),
      this.employees.findOne({ where: { id: employee.id } }),
    ]);
    return {
      categories: lookups.categories.map(chip),
      me: me
        ? {
            id: me.id,
            emp_code: me.emp_code,
            emp_display_name: me.emp_display_name,
          }
        : null,
    };
  }

  // ---- Helpers -------------------------------------------------------------

  /**
   * Reconcile `company_job_roles` from a DTO. Only ever used on a company that
   * is not live — an approved company's roles are written by the approval
   * handler instead, so an unapproved edit can't sneak past the sign-off.
   */
  private async writeRoles(
    companyId: number,
    roles: UpdateCompanyDto['roles'],
  ) {
    const existing = await this.jobRoles.find({
      where: { company_id: companyId },
    });
    const keptIds = new Set(
      roles.map((r) => r.id).filter((id): id is number => id != null),
    );
    const removed = existing.filter((e) => !keptIds.has(e.id));
    if (removed.length > 0) {
      await this.jobRoles.delete({ id: In(removed.map((e) => e.id)) });
    }
    for (const r of roles) {
      if (r.id != null && existing.some((e) => e.id === r.id)) {
        await this.jobRoles.update(
          { id: r.id },
          {
            role_name: r.role_name,
            responsible_employee_id: r.responsible_employee_id,
          },
        );
      } else {
        await this.jobRoles.save(
          this.jobRoles.create({
            company_id: companyId,
            role_name: r.role_name,
            responsible_employee_id: r.responsible_employee_id,
          }),
        );
      }
    }
  }

  private async mapDetail(company: Company) {
    const open = await this.approvals.openRequestFor(company.id);
    return {
      id: company.id,
      name: company.name,
      website: company.website,
      logo_url: company.logo_key
        ? await this.storage.getCachedReadUrl(company.logo_key)
        : null,
      approval_status: company.approval_status,
      is_active: company.is_active,
      categories: (company.categories ?? []).map(chip),
      roles: mapRoles(company),
      open_request: openRequest(open ?? undefined),
      created_at: company.created_at,
      updated_at: company.updated_at,
    };
  }
}
