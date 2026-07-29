import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { z } from 'zod';
import { Employee } from '../../admin/entities/employee.entity';
import { ApprovalApproversService } from '../../approval-approvers/approval-approvers.service';
import {
  ApprovalRequestDetailView,
  ApprovalRequestsService,
  RequesterRequestView,
} from '../../requests/approval-requests.service';
import {
  ApprovalRequest,
  OPEN_APPROVAL_REQUEST_STATUSES,
} from '../../requests/entities/approval-request.entity';
import {
  ApprovalRequestTypeHandler,
  DecidedStatus,
  DecisionInput,
  DecisionResult,
  RequestRequesterRef,
  RequestTypeRegistry,
} from '../../requests/request-type.registry';
import { StorageService } from '../../storage/storage.service';
import { UpdateCompanyDto } from './dto/company.dto';
import { Company } from './entities/company.entity';
import { CompanyCategory } from './entities/company-lookups.entity';
import { CompanyJobRole } from './entities/company-job-role.entity';

/** The request type this handler owns, and the action that routes it. */
export const COMPANY_REQUEST_TYPE = 'company_approval';
export const COMPANY_ACTION_KEY = 'corporate_relations.company';

export interface CompanyRolePayload {
  /**
   * Payload-local stable key ('r1', 'r2', …). Roles being ADDED have no db id
   * yet, so this — not `id` — is what an approver's override refers to and
   * what the timeline records.
   */
  key: string;
  /** Existing `company_job_roles.id`, or null for a role being added. */
  id: number | null;
  role_name: string;
  responsible_employee_id: number;
  /** Snapshotted at submit so history and read-only views need no join. */
  responsible_employee_name: string;
  responsible_employee_code: string;
}

export interface CompanySnapshot {
  name: string;
  website: string | null;
  logo_key: string | null;
  /** Presigned at view time by `enrichPayloadForView`; never persisted. */
  logo_url?: string | null;
  categories: { id: number; name: string }[];
  is_active: boolean | null;
  roles: CompanyRolePayload[];
}

export interface CompanyApprovalPayload {
  v: 1;
  /** A status change is an 'update' whose snapshot carries a new `is_active`. */
  kind: 'create' | 'update';
  company_id: number;
  /** The live company at submit time — the "from" side. Null for a create. */
  current: CompanySnapshot | null;
  /** What the raiser is asking for. Applied verbatim on approve. */
  proposed: CompanySnapshot;
  /** Written by applyDecision: `proposed.roles` + the approver's reassignments. */
  applied_roles?: CompanyRolePayload[];
  [k: string]: unknown;
}

/** What an approver may change while deciding: who owns each role. Nothing else. */
const OverridesSchema = z
  .object({
    role_officers: z
      .array(
        z
          .object({
            key: z.string().min(1),
            responsible_employee_id: z.coerce.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

/**
 * The `company_approval` request type: every create, edit and status change on
 * a company is signed off by the approvers an admin assigned to
 * `corporate_relations.company`.
 *
 * Two shapes of request, distinguished by `payload.kind`:
 *  - **create** — the company row already exists at `approval_status =
 *    'pending'` with `is_active` NULL. It is not live, so nothing is staged:
 *    approving flips it to approved+active, rejecting marks it rejected.
 *  - **update** — the company is live and STAYS on its current values. The
 *    whole proposal sits in `payload.proposed` and is only written on approve;
 *    rejecting simply drops it and leaves the live company untouched.
 *
 * Registered into the framework at boot, so RequestsModule never has to know
 * this module exists (same wiring as ProfileUpdateRequestService).
 */
@Injectable()
export class CompanyApprovalService
  implements ApprovalRequestTypeHandler, OnModuleInit
{
  readonly type = COMPANY_REQUEST_TYPE;

  readonly catalog = {
    module: {
      key: 'corporate_relations',
      label: 'Corporate Relations',
      icon: 'Building2',
      order: 20,
    },
    label: 'Company Approval',
    order: 10,
  };

  constructor(
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    @InjectRepository(CompanyJobRole)
    private readonly jobRoles: Repository<CompanyJobRole>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    private readonly requests: ApprovalRequestsService,
    private readonly approvers: ApprovalApproversService,
    private readonly storage: StorageService,
    private readonly registry: RequestTypeRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  // ---------------------------------------------------------------------------
  // Raising a request
  // ---------------------------------------------------------------------------

  /**
   * Build the payload from the LIVE company plus the proposal, and file it.
   * `current` is re-snapshotted on every submit (including resubmits), so the
   * "from" side always reflects reality at the moment it was raised rather
   * than whatever it was when the form was opened.
   */
  async raise(
    employeeId: number,
    companyId: number,
    kind: 'create' | 'update',
    dto: UpdateCompanyDto,
  ): Promise<RequesterRequestView> {
    const payload = await this.buildPayload(companyId, kind, dto);
    return this.requests.createForEmployee(
      employeeId,
      COMPANY_REQUEST_TYPE,
      COMPANY_ACTION_KEY,
      payload,
    );
  }

  /** Revise a sent-back request — same payload build, framework re-checks state. */
  async resubmit(
    employeeId: number,
    requestId: number,
    companyId: number,
    kind: 'create' | 'update',
    dto: UpdateCompanyDto,
  ): Promise<RequesterRequestView> {
    const payload = await this.buildPayload(companyId, kind, dto);
    return this.requests.resubmitForEmployee(
      employeeId,
      requestId,
      COMPANY_REQUEST_TYPE,
      payload,
    );
  }

  /**
   * The company's open request, ready to render next to the company itself —
   * so whoever is looking at the catalog can see what is pending without
   * hunting for it in the approvals inbox.
   *
   * Authorised by the CALLER's company-management screen, not by the approvals
   * inbox's approver scoping: seeing a company means seeing what is pending on
   * it. `can_act` says whether this employee may also decide it, which is a
   * strictly separate grant (the approvers an admin assigned to
   * {@link COMPANY_ACTION_KEY}).
   */
  async requestForCompany(
    companyId: number,
    employeeId: number,
  ): Promise<(ApprovalRequestDetailView & { can_act: boolean }) | null> {
    const request = await this.openRequestFor(companyId);
    if (!request) return null;
    const [view, isApprover] = await Promise.all([
      this.requests.detailViewFor(request),
      this.approvers.isApprover(employeeId, COMPANY_ACTION_KEY),
    ]);
    return { ...view, can_act: request.status === 'pending' && isApprover };
  }

  /**
   * Fold a logo uploaded AFTER the request was raised into its payload.
   *
   * A new company's logo can only be uploaded once the row exists, which is
   * strictly after `createCompany` filed the request — so the frozen snapshot
   * would keep `logo_key: null`. That is not just invisible to the approver:
   * `applyDecision` writes `proposed.logo_key` back onto the company, so
   * approving would blank the logo that was actually uploaded.
   */
  async syncLogoKey(companyId: number, logoKey: string): Promise<void> {
    const request = await this.openRequestFor(companyId);
    if (!request) return;
    const payload = request.payload as CompanyApprovalPayload;
    if (payload.proposed.logo_key === logoKey) return;
    payload.proposed = { ...payload.proposed, logo_key: logoKey };
    request.payload = { ...payload };
    await this.requestRepo().save(request);
  }

  /** The open (pending or sent-back) request for a company, if any. */
  async openRequestFor(companyId: number): Promise<ApprovalRequest | null> {
    const rows = await this.openRequestsForCompanies([companyId]);
    return rows.get(companyId) ?? null;
  }

  /**
   * Open requests for a whole page of companies in ONE query — the list needs
   * a "change pending" flag per row and must not go N+1 to get it.
   */
  async openRequestsForCompanies(
    companyIds: number[],
  ): Promise<Map<number, ApprovalRequest>> {
    if (companyIds.length === 0) return new Map();
    const rows = await this.requestRepo()
      .createQueryBuilder('r')
      .where('r.request_type = :type', { type: COMPANY_REQUEST_TYPE })
      .andWhere('r.status IN (:...open)', {
        open: [...OPEN_APPROVAL_REQUEST_STATUSES],
      })
      .andWhere("(r.payload->>'company_id')::int IN (:...ids)", {
        ids: companyIds,
      })
      .orderBy('r.id', 'DESC')
      .getMany();

    const byCompany = new Map<number, ApprovalRequest>();
    for (const r of rows) {
      const cid = Number((r.payload as CompanyApprovalPayload).company_id);
      // Ordered id DESC and at most one open request per company anyway, so
      // first-wins is the newest.
      if (!byCompany.has(cid)) byCompany.set(cid, r);
    }
    return byCompany;
  }

  private requestRepo(): Repository<ApprovalRequest> {
    return this.companies.manager.getRepository(ApprovalRequest);
  }

  private async buildPayload(
    companyId: number,
    kind: 'create' | 'update',
    dto: UpdateCompanyDto,
  ): Promise<CompanyApprovalPayload> {
    const company = await this.companies.findOne({
      where: { id: companyId },
      relations: {
        categories: true,
        job_roles: { responsible_employee: true },
      },
    });
    if (!company) throw new NotFoundException('Company not found.');

    const categories = await this.resolveCategories(dto.category_ids);
    const roles = await this.snapshotProposedRoles(dto.roles);

    const proposed: CompanySnapshot = {
      name: dto.name ?? company.name,
      website:
        dto.website === undefined ? company.website : (dto.website ?? null),
      logo_key:
        dto.logo_key === undefined ? company.logo_key : (dto.logo_key ?? null),
      categories:
        categories ??
        (company.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
      is_active:
        dto.is_active === undefined ? company.is_active : dto.is_active,
      roles,
    };

    return {
      v: 1,
      kind,
      company_id: companyId,
      current: kind === 'create' ? null : this.snapshotLive(company),
      proposed,
    };
  }

  private snapshotLive(company: Company): CompanySnapshot {
    return {
      name: company.name,
      website: company.website,
      logo_key: company.logo_key,
      categories: (company.categories ?? []).map((c) => ({
        id: c.id,
        name: c.name,
      })),
      is_active: company.is_active,
      roles: (company.job_roles ?? []).map((r, i) => ({
        key: `c${i + 1}`,
        id: r.id,
        role_name: r.role_name,
        responsible_employee_id: r.responsible_employee_id,
        responsible_employee_name:
          r.responsible_employee?.emp_display_name ?? '—',
        responsible_employee_code: r.responsible_employee?.emp_code ?? '—',
      })),
    };
  }

  private async resolveCategories(
    ids: number[] | undefined,
  ): Promise<{ id: number; name: string }[] | null> {
    if (ids === undefined) return null;
    if (ids.length === 0) return [];
    const rows = await this.companies.manager
      .getRepository(CompanyCategory)
      .find({ where: { id: In(ids) } });
    return rows.map((c) => ({ id: c.id, name: c.name }));
  }

  /** Resolve every proposed role's employee once, so the payload can name them. */
  private async snapshotProposedRoles(
    roles: UpdateCompanyDto['roles'],
  ): Promise<CompanyRolePayload[]> {
    const employees = await this.resolveEmployees(
      roles.map((r) => r.responsible_employee_id),
    );
    return roles.map((r, i) => {
      const e = employees.get(r.responsible_employee_id)!;
      return {
        key: `r${i + 1}`,
        id: r.id ?? null,
        role_name: r.role_name,
        responsible_employee_id: r.responsible_employee_id,
        responsible_employee_name: e.emp_display_name,
        responsible_employee_code: e.emp_code,
      };
    });
  }

  /** Every id must resolve to an ACTIVE employee — 400 naming the missing ones. */
  private async resolveEmployees(
    ids: number[],
    manager?: EntityManager,
  ): Promise<Map<number, Employee>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const repo = manager ? manager.getRepository(Employee) : this.employees;
    const rows = await repo.find({
      where: { id: In(unique), is_active: true },
    });
    const byId = new Map(rows.map((e) => [e.id, e]));
    const missing = unique.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Not an active employee: ${missing.join(', ')}. Pick someone else as the responsible person.`,
      );
    }
    return byId;
  }

  // ---------------------------------------------------------------------------
  // Handler hooks
  // ---------------------------------------------------------------------------

  /**
   * Lock on the COMPANY, not the requester: two managers editing one company
   * must serialize, or both duplicate checks miss each other's uncommitted row
   * and the company ends up with two open requests.
   */
  lockKeyFor(
    _requester: RequestRequesterRef,
    payload: Record<string, unknown>,
  ): string {
    return `company:${(payload as CompanyApprovalPayload).company_id}`;
  }

  async assertCreatable(
    tx: EntityManager,
    requester: RequestRequesterRef,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.assertSubmittable(tx, requester, payload, null);
  }

  async assertResubmittable(
    tx: EntityManager,
    requester: RequestRequesterRef,
    request: ApprovalRequest,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.assertSubmittable(tx, requester, payload, request.id);
  }

  private async assertSubmittable(
    tx: EntityManager,
    requester: RequestRequesterRef,
    raw: Record<string, unknown>,
    exceptRequestId: number | null,
  ): Promise<void> {
    if (requester.kind !== 'employee') {
      throw new InternalServerErrorException(
        'company_approval requests must have an employee requester',
      );
    }
    const payload = raw as CompanyApprovalPayload;

    const company = await tx
      .getRepository(Company)
      .findOne({ where: { id: payload.company_id } });
    if (!company) throw new NotFoundException('Company not found.');

    // One open request per company. Runs under the `company:<id>` advisory
    // lock taken by the framework, so a concurrent submit waits for this.
    const clash = await tx
      .getRepository(ApprovalRequest)
      .createQueryBuilder('r')
      .where('r.request_type = :type', { type: COMPANY_REQUEST_TYPE })
      .andWhere('r.status IN (:...open)', {
        open: [...OPEN_APPROVAL_REQUEST_STATUSES],
      })
      .andWhere("(r.payload->>'company_id')::int = :cid", {
        cid: payload.company_id,
      })
      .andWhere(exceptRequestId === null ? '1=1' : 'r.id <> :except', {
        except: exceptRequestId ?? 0,
      })
      .getExists();
    if (clash) {
      throw new ConflictException(
        'This company already has a change awaiting approval. Cancel that request or wait for a decision.',
      );
    }

    // A create request belongs to a company that was never approved; an update
    // to one that is live. Anything else means the form and the row disagree.
    if (payload.kind === 'create' && company.approval_status === 'approved') {
      throw new ConflictException(
        'This company is already approved — edit it instead.',
      );
    }
    if (payload.kind === 'update' && company.approval_status !== 'approved') {
      throw new ConflictException(
        'This company is not approved yet — its details are edited directly.',
      );
    }

    this.assertRolesValid(payload.proposed.roles);

    // Names are unique across companies; catching it here gives a readable
    // error instead of a 23505 at apply time, when it is far too late.
    const nameClash = await tx
      .getRepository(Company)
      .createQueryBuilder('c')
      .where('LOWER(c.name) = LOWER(:name)', { name: payload.proposed.name })
      .andWhere('c.id <> :id', { id: payload.company_id })
      .getExists();
    if (nameClash) {
      throw new ConflictException(
        `Another company is already called "${payload.proposed.name}".`,
      );
    }

    await this.resolveEmployees(
      payload.proposed.roles.map((r) => r.responsible_employee_id),
      tx,
    );
  }

  private assertRolesValid(roles: CompanyRolePayload[]): void {
    if (roles.length === 0) {
      throw new BadRequestException('Add at least one job role.');
    }
    const seen = new Set<string>();
    for (const r of roles) {
      const name = r.role_name.trim();
      if (!name) throw new BadRequestException('Give every job role a name.');
      const key = name.toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException(
          `"${name}" is listed twice — job roles must be distinct.`,
        );
      }
      seen.add(key);
    }
  }

  /**
   * Approve or reject as a whole. A company is not decidable per item — half a
   * company is not a thing — so `{ verdicts }` is rejected outright, which is
   * what the registry prescribes for types without per-item support.
   *
   * On approve the proposal is written to the company row, with the approver's
   * role reassignments merged in first. On reject nothing is written except
   * for a refused CREATE, which marks the (never-live) company rejected.
   */
  async applyDecision(
    tx: EntityManager,
    request: ApprovalRequest,
    input: DecisionInput,
  ): Promise<DecisionResult> {
    if (!('verdict' in input)) {
      throw new BadRequestException(
        'A company request is approved or rejected as a whole, not field by field.',
      );
    }
    const payload = request.payload as CompanyApprovalPayload;
    const status: DecidedStatus = input.verdict;

    const overrides = this.parseOverrides(input.overrides, payload, status);
    const companyRepo = tx.getRepository(Company);

    if (status === 'rejected') {
      // A refused EDIT leaves the live company exactly as it is — taking a
      // working company off the catalog because someone's change was refused
      // would be collateral damage. Only a refused CREATE marks the row, since
      // that company was never live in the first place.
      if (payload.kind === 'create') {
        await companyRepo.update(
          { id: payload.company_id },
          { approval_status: 'rejected' },
        );
      }
      return { status, payload: { ...payload } };
    }

    const company = await companyRepo
      .createQueryBuilder('c')
      .setLock('pessimistic_write')
      .where('c.id = :id', { id: payload.company_id })
      .getOne();
    if (!company) {
      throw new ConflictException(
        'The company was deleted while this request was pending.',
      );
    }

    const finalRoles = await this.mergeRoleOfficers(
      tx,
      payload.proposed.roles,
      overrides,
    );

    try {
      await companyRepo.update(
        { id: company.id },
        {
          name: payload.proposed.name,
          website: payload.proposed.website,
          logo_key: payload.proposed.logo_key,
          approval_status: 'approved',
          // NULL → true on a first approval; an explicit false (a deactivation
          // request) is honoured, and a company deactivated earlier is not
          // silently reactivated by an unrelated edit.
          is_active: payload.proposed.is_active ?? true,
        },
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as never as { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          `Another company is already called "${payload.proposed.name}". Reject this request or ask for a different name.`,
        );
      }
      throw err;
    }

    await this.applyCategories(tx, company.id, payload.proposed.categories);
    await this.applyRoles(tx, company.id, finalRoles);

    return {
      status,
      payload: { ...payload, applied_roles: finalRoles },
    };
  }

  private parseOverrides(
    raw: Record<string, unknown> | undefined,
    payload: CompanyApprovalPayload,
    status: DecidedStatus,
  ): Map<string, number> {
    const out = new Map<string, number>();
    if (!raw) return out;
    if (status === 'rejected') {
      throw new BadRequestException(
        'There is nothing to apply on a rejected request — drop the edits or approve it.',
      );
    }

    const parsed = OverridesSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(
        'Only the responsible person on a job role can be changed while approving.',
      );
    }
    const known = new Set(payload.proposed.roles.map((r) => r.key));
    for (const o of parsed.data.role_officers ?? []) {
      if (!known.has(o.key)) {
        throw new BadRequestException(
          `Unknown job role "${o.key}" — the request may have been resubmitted since you opened it.`,
        );
      }
      out.set(o.key, o.responsible_employee_id);
    }
    return out;
  }

  /**
   * The roles as they will be written: the proposal, with the approver's
   * reassignments applied. Names/codes are re-resolved from the DB — a
   * client-supplied display name is never trusted onto the record.
   */
  private async mergeRoleOfficers(
    tx: EntityManager,
    roles: CompanyRolePayload[],
    overrides: Map<string, number>,
  ): Promise<CompanyRolePayload[]> {
    const merged = roles.map((r) => ({
      ...r,
      responsible_employee_id:
        overrides.get(r.key) ?? r.responsible_employee_id,
    }));
    const employees = await this.resolveEmployees(
      merged.map((r) => r.responsible_employee_id),
      tx,
    );
    return merged.map((r) => {
      const e = employees.get(r.responsible_employee_id)!;
      return {
        ...r,
        responsible_employee_name: e.emp_display_name,
        responsible_employee_code: e.emp_code,
      };
    });
  }

  private async applyCategories(
    tx: EntityManager,
    companyId: number,
    categories: { id: number }[],
  ): Promise<void> {
    const repo = tx.getRepository(Company);
    const company = await repo.findOne({
      where: { id: companyId },
      relations: { categories: true },
    });
    if (!company) return;
    company.categories = categories.map((c) => ({
      id: c.id,
    })) as CompanyCategory[];
    await repo.save(company);
  }

  /** Reconcile `company_job_roles`: drop what's gone, update ids, insert the rest. */
  private async applyRoles(
    tx: EntityManager,
    companyId: number,
    roles: CompanyRolePayload[],
  ): Promise<void> {
    const repo = tx.getRepository(CompanyJobRole);
    const existing = await repo.find({ where: { company_id: companyId } });
    const keptIds = new Set(
      roles.map((r) => r.id).filter((id): id is number => id !== null),
    );

    const removed = existing.filter((e) => !keptIds.has(e.id));
    if (removed.length > 0) {
      await repo.delete({ id: In(removed.map((e) => e.id)) });
    }

    for (const r of roles) {
      if (r.id !== null && existing.some((e) => e.id === r.id)) {
        await repo.update(
          { id: r.id },
          {
            role_name: r.role_name,
            responsible_employee_id: r.responsible_employee_id,
          },
        );
      } else {
        await repo.save(
          repo.create({
            company_id: companyId,
            role_name: r.role_name,
            responsible_employee_id: r.responsible_employee_id,
          }),
        );
      }
    }
  }

  decisionNotification(
    request: ApprovalRequest,
    status: DecidedStatus,
    note: string | null,
  ): { title: string; body: string } {
    const payload = request.payload as CompanyApprovalPayload;
    const name = payload.proposed?.name ?? 'the company';
    const suffix = note ? ` Note: ${note}` : '';

    // Post-commit side effect, same trick the profile-update handler uses for
    // rejected certificate files: drop the logo object that lost. `deleteObject`
    // never throws, so a failed cleanup can't break the notification.
    const oldKey = payload.current?.logo_key ?? null;
    const newKey = payload.proposed?.logo_key ?? null;
    if (oldKey !== newKey) {
      const orphan = status === 'approved' ? oldKey : newKey;
      if (orphan) void this.storage.deleteObject(orphan);
    }

    if (status === 'approved') {
      return payload.kind === 'create'
        ? {
            title: 'Company approved',
            body: `${name} has been approved and is now live in the catalog.${suffix}`,
          }
        : {
            title: 'Company changes approved',
            body: `Your changes to ${name} have been applied.${suffix}`,
          };
    }
    return {
      title:
        payload.kind === 'create'
          ? 'Company request rejected'
          : 'Company changes rejected',
      body:
        payload.kind === 'create'
          ? `${name} was not approved.${suffix}`
          : `Your changes to ${name} were not applied.${suffix}`,
    };
  }

  /** Presign both logos so the approver can see what is being replaced. */
  async enrichPayloadForView(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const p = payload as CompanyApprovalPayload;
    const withUrl = async (s: CompanySnapshot | null) => {
      if (!s) return s;
      return {
        ...s,
        logo_url: s.logo_key
          ? await this.storage.getCachedReadUrl(s.logo_key)
          : null,
      };
    };
    return {
      ...p,
      current: await withUrl(p.current),
      proposed: await withUrl(p.proposed),
    };
  }
}
