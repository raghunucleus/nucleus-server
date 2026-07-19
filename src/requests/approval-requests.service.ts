import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ProgrammeAdmissionYear } from '../admin/entities/programme-admission-year.entity';
import { ProgrammeAdmissionYearProfileVerifier } from '../admin/entities/programme-admission-year-profile-verifier.entity';
import { Student } from '../admin/entities/student.entity';
import { EmployeeNotificationService } from '../employee/notification/employee-notification.service';
import { StudentNotificationService } from '../student/notification/student-notification.service';
import { ApprovalRequestEvent } from './entities/approval-request-event.entity';
import {
  APPROVAL_REQUEST_STATUSES,
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRequestType,
  OPEN_APPROVAL_REQUEST_STATUSES,
} from './entities/approval-request.entity';
import {
  DecidedStatus,
  DecisionInput,
  RequestCatalogModule,
  RequestTypeRegistry,
} from './request-type.registry';

/** Requester-facing view — hides who decided (only that it was decided). */
export interface RequesterRequestView {
  id: number;
  request_type: string;
  status: string;
  payload: Record<string, unknown>;
  requester_note: string | null;
  decision_note: string | null;
  decided_at: Date | null;
  created_at: Date;
}

/** Approver-facing row — adds the requesting student and decision identity. */
export interface ApprovalRequestView extends RequesterRequestView {
  decided_by: { id: number; emp_display_name: string } | null;
  student: {
    id: number;
    student_id: string;
    display_name: string;
    programme_name: string;
    admission_year_display: string;
  };
}

/**
 * Someone who can act on a request — a profile verifier of its batch. The pool
 * is flat: any one of them can decide, there is no order or quorum, so this is
 * "who it's with", not a sequence of steps.
 */
export interface RequestApprover {
  id: number;
  emp_display_name: string;
  designation: string | null;
  department: string | null;
  /** Whether this approver is the one who actually decided it. */
  is_decider: boolean;
}

/** One entry in a request's history. */
export interface RequestEventView {
  event: string;
  at: Date;
  note: string | null;
  /** Null once the actor's row is gone — `kind` still says what they were. */
  actor: { kind: string; name: string | null } | null;
  detail: Record<string, unknown> | null;
}

/** The full picture of a request: current state + who can act + what happened. */
export interface RequesterRequestDetailView extends RequesterRequestView {
  approvers: RequestApprover[];
  timeline: RequestEventView[];
}

export interface ApprovalRequestDetailView extends ApprovalRequestView {
  approvers: RequestApprover[];
  timeline: RequestEventView[];
}

/** Counts per status for the chip strip. Global — never category-scoped. */
export type RequestStatusCounts = Record<string, number>;

export interface PaginatedApprovals {
  items: ApprovalRequestView[];
  total: number;
  page: number;
  limit: number;
}

export interface EmployeeListApprovalsInput {
  status: ApprovalRequestStatus | 'all';
  type?: ApprovalRequestType;
  /** Inclusive local-date window on created_at (YYYY-MM-DD). */
  from?: string;
  to?: string;
  sort: 'newest' | 'oldest';
  page: number;
  limit: number;
}

/** The day after a `YYYY-MM-DD` date, as `YYYY-MM-DD` (UTC math, date-only). */
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The generic approval-requests framework — owns lifecycle only: requester
 * identity, one-pending-per-type, verifier routing, status transitions,
 * decision metadata and requester notifications. Everything type-specific
 * (payload shape/validation, what "approve" applies, notification copy) comes
 * from the type's handler registered in {@link RequestTypeRegistry} by its
 * owning module.
 */
@Injectable()
export class ApprovalRequestsService {
  private readonly logger = new Logger('ApprovalRequestsService');

  constructor(
    @InjectRepository(ApprovalRequest)
    private readonly requests: Repository<ApprovalRequest>,
    @InjectRepository(ApprovalRequestEvent)
    private readonly events: Repository<ApprovalRequestEvent>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(ProgrammeAdmissionYear)
    private readonly batches: Repository<ProgrammeAdmissionYear>,
    @InjectRepository(ProgrammeAdmissionYearProfileVerifier)
    private readonly profileVerifiers: Repository<ProgrammeAdmissionYearProfileVerifier>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: StudentNotificationService,
    private readonly employeeNotifications: EmployeeNotificationService,
    private readonly registry: RequestTypeRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // Requester side (students)
  // ---------------------------------------------------------------------------

  /**
   * File a request on behalf of a student. The caller (the type's own module)
   * has already validated the payload and snapshotted whatever it needs —
   * this method only applies the framework rules: resolve the routing batch,
   * require someone who can act on it, run the type's duplicate check,
   * persist. Several pending requests of one type may coexist.
   */
  async createForStudent(
    studentId: number,
    type: ApprovalRequestType,
    payload: Record<string, unknown>,
    note?: string | null,
  ): Promise<RequesterRequestView> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    // Approvers are the profile verifiers of the student's batch; without the
    // batch row the request could never be routed to anyone.
    const batch = await this.batches.findOne({
      where: {
        programme_id: student.programme_id,
        admission_year_id: student.admission_year_id,
      },
    });
    if (!batch) {
      throw new UnprocessableEntityException(
        'Your batch is not set up for approvals yet. Please contact the college office.',
      );
    }

    // A batch with zero verifiers would swallow the request — nobody could
    // ever see or decide it. Fail up front instead of parking it in a void.
    const hasVerifiers = await this.profileVerifiers.exists({
      where: { programme_admission_year_id: batch.id },
    });
    if (!hasVerifiers) {
      throw new UnprocessableEntityException(
        'Approvals are not set up for your batch yet. Please contact the college office.',
      );
    }

    const handler = this.registry.get(type);
    const saved = await this.dataSource.transaction(async (tx) => {
      // Serialize concurrent submits per (requester, type) so the handler's
      // duplicate check can't be raced — the lock releases on commit/rollback.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `approval_requests:student:${studentId}:${type}`,
      ]);
      await handler.assertCreatable?.(tx, studentId, payload);
      const repo = tx.getRepository(ApprovalRequest);
      const row = await repo.save(
        repo.create({
          request_type: type,
          status: 'pending',
          requester_student_id: studentId,
          payload,
          requester_note: note ?? null,
          programme_admission_year_id: batch.id,
        }),
      );
      await this.logEvent(
        tx,
        row.id,
        'raised',
        {
          kind: 'student',
          id: studentId,
        },
        note ?? null,
        payload,
      );
      return row;
    });
    // After commit only, and fire-and-forget — a rolled-back submit must not
    // summon anyone, and a notification failure must never turn a saved request
    // into a failed one for the student.
    this.dispatchApproverNotification(saved, studentId, 'raised');
    return this.toRequesterView(saved);
  }

  async listForStudent(
    studentId: number,
    filters: { status?: ApprovalRequestStatus; type?: ApprovalRequestType },
  ): Promise<RequesterRequestView[]> {
    const rows = await this.requests.find({
      where: {
        requester_student_id: studentId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.type ? { request_type: filters.type } : {}),
      },
      order: { id: 'DESC' },
    });
    return rows.map((r) => this.toRequesterView(r));
  }

  /**
   * The student's still-open requests of a type — pending, or sent back for
   * changes (several may coexist). Type handlers read these for duplicate
   * checks and form context; a sent-back request still holds its claim.
   */
  async openRequests(
    studentId: number,
    type: ApprovalRequestType,
  ): Promise<ApprovalRequest[]> {
    return this.requests.find({
      where: {
        requester_student_id: studentId,
        request_type: type,
        status: In([...OPEN_APPROVAL_REQUEST_STATUSES]),
      },
      order: { id: 'DESC' },
    });
  }

  /**
   * The full picture of one of the student's own requests. The id is matched
   * against the acting student — a request that isn't theirs is a 404, never a
   * 403, so ids can't be probed.
   */
  async getForStudent(
    studentId: number,
    id: number,
  ): Promise<RequesterRequestDetailView> {
    const row = await this.requests.findOne({
      where: { id, requester_student_id: studentId },
    });
    if (!row) throw new NotFoundException('Request not found');
    const [approvers, timeline, payload] = await Promise.all([
      this.approversFor(row),
      this.timelineFor(row.id),
      this.enrichedPayload(row),
    ]);
    return { ...this.toRequesterView(row), payload, approvers, timeline };
  }

  /** Chip counts across ALL of the student's requests — never type-scoped. */
  async countsForStudent(studentId: number): Promise<RequestStatusCounts> {
    const rows = await this.requests
      .createQueryBuilder('r')
      .select('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('r.requester_student_id = :me', { me: studentId })
      .groupBy('r.status')
      .getRawMany<{ status: string; count: string }>();
    return this.tallyStatuses(rows);
  }

  /**
   * Revise a sent-back request and put it back in the approver's queue. The
   * owning module rebuilds the payload; the framework re-checks ownership and
   * status under the same per-(requester, type) advisory lock as create, so a
   * resubmit racing a cancel serializes.
   */
  async resubmitForStudent(
    studentId: number,
    id: number,
    type: ApprovalRequestType,
    payload: Record<string, unknown>,
    note?: string | null,
  ): Promise<RequesterRequestView> {
    const handler = this.registry.get(type);
    const saved = await this.dataSource.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `approval_requests:student:${studentId}:${type}`,
      ]);
      const repo = tx.getRepository(ApprovalRequest);
      const row = await repo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id })
        .getOne();

      // 404 on someone else's request — never reveal that the id exists.
      if (!row || row.requester_student_id !== studentId) {
        throw new NotFoundException('Request not found');
      }
      if (row.status !== 'sent_back') {
        throw new ConflictException(
          'Only a request that was sent back to you can be resubmitted.',
        );
      }

      await handler.assertResubmittable?.(tx, studentId, row, payload);

      await repo.update(
        { id: row.id, status: 'sent_back' },
        {
          status: 'pending',
          payload: payload as ApprovalRequest['payload'] &
            Record<string, never>,
          requester_note: note ?? null,
          // Clear the send-back metadata — the decision block on the clients
          // reads these, and a resubmitted request is undecided again. The
          // history keeps the send-back.
          decided_by_employee_id: null,
          decided_at: null,
          decision_note: null,
        },
      );
      await this.logEvent(
        tx,
        row.id,
        'resubmitted',
        {
          kind: 'student',
          id: studentId,
        },
        note ?? null,
        payload,
      );
      row.status = 'pending';
      row.payload = payload;
      row.requester_note = note ?? null;
      row.decided_at = null;
      row.decision_note = null;
      return row;
    });
    // A resubmit puts the request back in the verifiers' queue, so it warrants
    // the same nudge as a fresh one. Post-commit, fire-and-forget (see create).
    this.dispatchApproverNotification(saved, studentId, 'resubmitted');
    return this.toRequesterView(saved);
  }

  /**
   * Requester cancels their own request — allowed while it is still open,
   * i.e. pending OR sent back to them for changes.
   */
  async cancelForStudent(
    studentId: number,
    id: number,
  ): Promise<RequesterRequestView> {
    return this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(ApprovalRequest);
      const row = await repo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id })
        .getOne();

      if (!row || row.requester_student_id !== studentId) {
        throw new NotFoundException('Request not found');
      }
      if (
        !(OPEN_APPROVAL_REQUEST_STATUSES as readonly string[]).includes(
          row.status,
        )
      ) {
        throw new ConflictException(
          'This request has already been decided and can no longer be cancelled.',
        );
      }

      await repo.update({ id: row.id }, { status: 'cancelled' });
      await this.logEvent(tx, row.id, 'cancelled', {
        kind: 'student',
        id: studentId,
      });
      row.status = 'cancelled';
      return this.toRequesterView(row);
    });
  }

  // ---------------------------------------------------------------------------
  // Approver side (employees — profile verifiers of the request's batch)
  // ---------------------------------------------------------------------------

  async listApprovals(
    employeeId: number,
    q: EmployeeListApprovalsInput,
  ): Promise<PaginatedApprovals> {
    const qb = this.approvalsQuery(employeeId);
    if (q.status !== 'all') {
      qb.andWhere('r.status = :st', { st: q.status });
    }
    if (q.type) qb.andWhere('r.request_type = :ty', { ty: q.type });
    if (q.from) qb.andWhere('r.created_at >= :from', { from: q.from });
    // Inclusive end: everything before the day after `to` (covers `to` in full).
    // The next-day bound is computed here to avoid a `::date` cast, which
    // TypeORM's parameter parser can mistake for a `:date` named parameter.
    if (q.to) {
      qb.andWhere('r.created_at < :toExclusive', {
        toExclusive: nextDay(q.to),
      });
    }

    const dir = q.sort === 'oldest' ? 'ASC' : 'DESC';
    const [rows, total] = await qb
      .orderBy('r.created_at', dir)
      .addOrderBy('r.id', dir)
      .skip((q.page - 1) * q.limit)
      .take(q.limit)
      .getManyAndCount();

    return {
      items: rows.map((r) => this.toApprovalView(r)),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async getApproval(
    employeeId: number,
    id: number,
  ): Promise<ApprovalRequestView> {
    const row = await this.approvalsQuery(employeeId)
      .andWhere('r.id = :id', { id })
      .getOne();
    // 404 (never 403): a verifier must not be able to probe request ids
    // belonging to batches they don't verify.
    if (!row) throw new NotFoundException('Request not found');
    return this.toApprovalView(row);
  }

  /** getApproval + the approver pool and history. Same 404-never-403 scoping. */
  async getApprovalDetail(
    employeeId: number,
    id: number,
  ): Promise<ApprovalRequestDetailView> {
    const row = await this.approvalsQuery(employeeId)
      .andWhere('r.id = :id', { id })
      .getOne();
    if (!row) throw new NotFoundException('Request not found');
    const [approvers, timeline, payload] = await Promise.all([
      this.approversFor(row),
      this.timelineFor(row.id),
      this.enrichedPayload(row),
    ]);
    return { ...this.toApprovalView(row), payload, approvers, timeline };
  }

  /**
   * Chip counts across every request this employee can see — global, not
   * scoped to a type/category, so the chips don't recount as the Modules panel
   * filters the list below.
   */
  async countsForApprovals(employeeId: number): Promise<RequestStatusCounts> {
    const rows = await this.requests
      .createQueryBuilder('r')
      .innerJoin(
        ProgrammeAdmissionYearProfileVerifier,
        'v',
        'v.programme_admission_year_id = r.programme_admission_year_id AND v.employee_id = :me',
        { me: employeeId },
      )
      .select('r.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.status')
      .getRawMany<{ status: string; count: string }>();
    return this.tallyStatuses(rows);
  }

  /**
   * Decide a pending request — uniformly (`{ verdict }`) or per item
   * (`{ verdicts }`, e.g. approve some profile fields and reject others).
   * Runs in a transaction with a row lock so two verifiers acting at once
   * serialize — the loser sees 409. The type's handler applies whatever was
   * approved and returns the overall status plus the payload annotated with
   * per-item outcomes; if it throws, the whole decision rolls back and the
   * request stays pending.
   */
  async decide(
    employeeId: number,
    id: number,
    input: DecisionInput,
    note?: string | null,
  ): Promise<ApprovalRequestView> {
    const { row: decided, status } = await this.dataSource.transaction(
      async (tx) => {
        const repo = tx.getRepository(ApprovalRequest);
        const row = await repo
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id })
          .getOne();

        if (
          !row ||
          row.requester_student_id === null ||
          row.programme_admission_year_id === null
        ) {
          throw new NotFoundException('Request not found');
        }

        const isVerifier = await tx
          .getRepository(ProgrammeAdmissionYearProfileVerifier)
          .exists({
            where: {
              employee_id: employeeId,
              programme_admission_year_id: row.programme_admission_year_id,
            },
          });
        if (!isVerifier) throw new NotFoundException('Request not found');

        if (row.status !== 'pending') {
          throw new ConflictException('This request has already been decided.');
        }

        const result = await this.registry
          .get(row.request_type)
          .applyDecision(tx, row, input);

        await repo.update(
          { id: row.id, status: 'pending' },
          {
            status: result.status,
            // TypeORM's QueryDeepPartialEntity can't digest the opaque
            // Record<string, unknown> jsonb type — the value is verbatim json.
            payload: result.payload as ApprovalRequest['payload'] &
              Record<string, never>,
            decided_by_employee_id: employeeId,
            decided_at: new Date(),
            decision_note: note ?? null,
          },
        );
        // `detail` snapshots the outcome-annotated payload: a later resubmit
        // rewrites approval_requests.payload, and the timeline must still show
        // what was decided at THIS moment.
        await this.logEvent(
          tx,
          row.id,
          result.status,
          { kind: 'employee', id: employeeId },
          note ?? null,
          result.payload,
        );
        // Carry the outcome-annotated payload to the notification step.
        row.payload = result.payload;
        return { row, status: result.status };
      },
    );

    // Only after the transaction committed — a rolled-back approve must never
    // push an "approved" notification.
    await this.notifyDecision(decided, status, note ?? null);
    return this.getApproval(employeeId, id);
  }

  /**
   * Return a pending request to its requester for changes. Deliberately NOT a
   * decision: nothing type-specific is applied, no handler runs, and the type's
   * `applyDecision` is never called — the request simply parks with the student
   * until they resubmit or cancel. Same lock + verifier re-check + pending
   * guard as {@link decide}, so a send-back racing an approve loses with 409.
   */
  async sendBack(
    employeeId: number,
    id: number,
    note: string,
  ): Promise<ApprovalRequestView> {
    const sentBack = await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(ApprovalRequest);
      const row = await repo
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :id', { id })
        .getOne();

      if (
        !row ||
        row.requester_student_id === null ||
        row.programme_admission_year_id === null
      ) {
        throw new NotFoundException('Request not found');
      }

      const isVerifier = await tx
        .getRepository(ProgrammeAdmissionYearProfileVerifier)
        .exists({
          where: {
            employee_id: employeeId,
            programme_admission_year_id: row.programme_admission_year_id,
          },
        });
      if (!isVerifier) throw new NotFoundException('Request not found');

      if (row.status !== 'pending') {
        throw new ConflictException('Only a pending request can be sent back.');
      }

      await repo.update(
        { id: row.id, status: 'pending' },
        {
          status: 'sent_back',
          // Reuse the decision columns to carry "who sent it back, when, why" —
          // resubmit clears them. `status` is what distinguishes this from a
          // real decision.
          decided_by_employee_id: employeeId,
          decided_at: new Date(),
          decision_note: note,
        },
      );
      await this.logEvent(
        tx,
        row.id,
        'sent_back',
        {
          kind: 'employee',
          id: employeeId,
        },
        note,
      );
      row.status = 'sent_back';
      return row;
    });

    // After commit only — a rolled-back send-back must not notify.
    await this.notifySentBack(sentBack, note);
    return this.getApproval(employeeId, id);
  }

  /** The employee's own submitted requests (no employee-creatable types yet). */
  async listMine(employeeId: number): Promise<RequesterRequestView[]> {
    const rows = await this.requests.find({
      where: { requester_employee_id: employeeId },
      order: { id: 'DESC' },
    });
    return rows.map((r) => this.toRequesterView(r));
  }

  /** The Modules tree — every registered request type, grouped. */
  catalog(): RequestCatalogModule[] {
    return this.registry.catalog();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Append one history entry. Always takes the caller's `tx` so the event and
   * the state change it describes commit or roll back together — a decision
   * that throws in a handler must leave no trace of having happened.
   */
  private async logEvent(
    tx: EntityManager,
    requestId: number,
    event: string,
    actor: { kind: 'student' | 'employee' | 'system'; id: number | null },
    note: string | null = null,
    detail: Record<string, unknown> | null = null,
  ): Promise<void> {
    const repo = tx.getRepository(ApprovalRequestEvent);
    await repo.save(
      repo.create({
        approval_request_id: requestId,
        event,
        actor_kind: actor.kind,
        actor_student_id: actor.kind === 'student' ? actor.id : null,
        actor_employee_id: actor.kind === 'employee' ? actor.id : null,
        note,
        detail,
      }),
    );
  }

  /**
   * The payload as the DETAIL views should render it: passed through the
   * type's optional `enrichPayloadForView` (e.g. presigned file URLs).
   * View-only — never persisted; enrichment failures fall back to the raw
   * payload rather than failing the request fetch.
   */
  private async enrichedPayload(
    request: ApprovalRequest,
  ): Promise<Record<string, unknown>> {
    const handler = this.registry.get(request.request_type);
    if (!handler.enrichPayloadForView) return request.payload;
    try {
      return await handler.enrichPayloadForView(request.payload);
    } catch {
      return request.payload;
    }
  }

  /**
   * The pool who can act on a request — every profile verifier of its batch,
   * flagging whoever actually decided. Flat by design: any one of them can
   * decide, so this is "who it's with", not a sequence.
   */
  private async approversFor(
    request: ApprovalRequest,
  ): Promise<RequestApprover[]> {
    if (request.programme_admission_year_id === null) return [];
    // `employee` is non-eager on the verifier row (it would cycle with
    // Employee.department), so join it and its lookups explicitly.
    const rows = await this.profileVerifiers
      .createQueryBuilder('v')
      .innerJoinAndSelect('v.employee', 'e')
      .leftJoinAndSelect('e.designation', 'dg')
      .leftJoinAndSelect('e.department', 'dp')
      .where('v.programme_admission_year_id = :pay', {
        pay: request.programme_admission_year_id,
      })
      .orderBy('e.emp_display_name', 'ASC')
      .getMany();

    return rows.map((v) => ({
      id: v.employee.id,
      emp_display_name: v.employee.emp_display_name,
      designation: v.employee.designation?.name ?? null,
      department: v.employee.department?.name ?? null,
      is_decider: v.employee_id === request.decided_by_employee_id,
    }));
  }

  /** A request's history, oldest first — the order it happened in. */
  private async timelineFor(requestId: number): Promise<RequestEventView[]> {
    const rows = await this.events.find({
      where: { approval_request_id: requestId },
      relations: { actor_student: true, actor_employee: true },
      order: { id: 'ASC' },
    });
    return rows.map((e) => ({
      event: e.event,
      at: e.created_at,
      note: e.note,
      actor:
        e.actor_kind === 'system'
          ? { kind: 'system', name: null }
          : {
              kind: e.actor_kind,
              // Null once the actor row is gone (both FKs are SET NULL) —
              // `kind` still says what they were.
              name:
                e.actor_student?.display_name ??
                e.actor_employee?.emp_display_name ??
                null,
            },
      detail: e.detail,
    }));
  }

  /** Seed every status at 0 so a chip renders a count even with no rows. */
  private tallyStatuses(rows: { status: string; count: string }[]) {
    const counts: RequestStatusCounts = {};
    for (const s of APPROVAL_REQUEST_STATUSES) counts[s] = 0;
    for (const r of rows) counts[r.status] = Number(r.count);
    return counts;
  }

  /**
   * Base approver query: INNER JOIN on the verifier table scopes rows to
   * batches the acting employee verifies — the verifier table IS the scope
   * (the RBAC screen carries no attributes). Student's programme/admission
   * year are joined explicitly because QueryBuilder ignores `eager:`.
   */
  private approvalsQuery(employeeId: number) {
    return this.requests
      .createQueryBuilder('r')
      .innerJoin(
        ProgrammeAdmissionYearProfileVerifier,
        'v',
        'v.programme_admission_year_id = r.programme_admission_year_id AND v.employee_id = :me',
        { me: employeeId },
      )
      .innerJoinAndSelect('r.requester_student', 's')
      .leftJoinAndSelect('s.programme', 'p')
      .leftJoinAndSelect('s.admission_year', 'ay')
      .leftJoinAndSelect('r.decided_by_employee', 'de');
  }

  private toRequesterView(r: ApprovalRequest): RequesterRequestView {
    return {
      id: r.id,
      request_type: r.request_type,
      status: r.status,
      payload: r.payload,
      requester_note: r.requester_note,
      decision_note: r.decision_note,
      decided_at: r.decided_at,
      created_at: r.created_at,
    };
  }

  private toApprovalView(r: ApprovalRequest): ApprovalRequestView {
    return {
      ...this.toRequesterView(r),
      decided_by: r.decided_by_employee
        ? {
            id: r.decided_by_employee.id,
            emp_display_name: r.decided_by_employee.emp_display_name,
          }
        : null,
      student: {
        id: r.requester_student.id,
        student_id: r.requester_student.student_id,
        display_name: r.requester_student.display_name,
        programme_name: r.requester_student.programme?.name ?? '—',
        admission_year_display:
          r.requester_student.admission_year?.display_year ?? '—',
      },
    };
  }

  /**
   * Send-back copy is generic on purpose — nothing type-specific happened, so
   * there is no handler hook for it. The type's catalog label keeps the copy
   * readable ("Your Profile Update request…") without the framework knowing
   * anything about the type.
   */
  private async notifySentBack(
    request: ApprovalRequest,
    note: string,
  ): Promise<void> {
    if (request.requester_student_id === null) return;
    const label = this.registry.get(request.request_type).catalog.label;
    await this.notifications.send(request.requester_student_id, {
      module: 'requests',
      type: `${request.request_type}-sent_back`,
      title: `${label} request needs changes`,
      body: `Your ${label.toLowerCase()} request was sent back for changes: ${note}`,
      target: { type: 'request', id: request.id },
    });
  }

  private async notifyDecision(
    request: ApprovalRequest,
    status: DecidedStatus,
    note: string | null,
  ): Promise<void> {
    if (request.requester_student_id === null) return;
    const copy = this.registry
      .get(request.request_type)
      .decisionNotification(request, status, note);
    await this.notifications.send(request.requester_student_id, {
      module: 'requests',
      type: `${request.request_type}-${status}`,
      title: copy.title,
      body: copy.body,
      target: { type: 'request', id: request.id },
    });
  }

  /**
   * Tell the request's approvers it is waiting on them. Detached on purpose:
   * the request is already committed by the time this runs, so nothing here may
   * reject into the student's submit.
   */
  private dispatchApproverNotification(
    request: ApprovalRequest,
    studentId: number,
    kind: 'raised' | 'resubmitted',
  ): void {
    void this.notifyApprovers(request, studentId, kind).catch((err) =>
      this.logger.error(
        `Approver notification for request ${request.id} failed: ${String(err)}`,
      ),
    );
  }

  /**
   * Copy is generic on purpose — same reasoning as {@link notifySentBack}.
   * Nothing type-specific has happened yet (nobody has decided anything), so
   * there is no handler hook, and the framework must not read into the opaque
   * payload to count or name fields. The type's catalog label carries the
   * meaning.
   *
   * Email is on: a request nobody has looked at is exactly the case where the
   * inbox beats a badge someone has to go looking for.
   */
  private async notifyApprovers(
    request: ApprovalRequest,
    studentId: number,
    kind: 'raised' | 'resubmitted',
  ): Promise<void> {
    const approverIds = await this.approverIdsFor(
      request.programme_admission_year_id,
    );
    if (approverIds.length === 0) return;

    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) return;

    const label = this.registry.get(request.request_type).catalog.label;
    const lower = label.toLowerCase();
    await this.employeeNotifications.send(
      approverIds,
      {
        module: 'requests',
        type: `${request.request_type}-${kind}`,
        // Cased like the sibling requester-facing copy in `notifySentBack`
        // ("<Label> request needs changes") so the whole module reads alike.
        title:
          kind === 'raised'
            ? `New ${label} request to review`
            : `${label} request resubmitted`,
        body: `${student.display_name} (${student.student_id}) ${kind === 'raised' ? 'raised' : 'resubmitted'} a ${lower} request for your approval.`,
        target: { type: 'request', id: request.id },
      },
      { email: true },
    );
  }

  /**
   * Just the employee ids of a batch's verifiers — the recipient list. Separate
   * from {@link approversFor}, which joins designation/department for display
   * that a notification fan-out has no use for.
   */
  private async approverIdsFor(
    programmeAdmissionYearId: number | null,
  ): Promise<number[]> {
    if (programmeAdmissionYearId === null) return [];
    const rows = await this.profileVerifiers.find({
      where: { programme_admission_year_id: programmeAdmissionYearId },
      select: { employee_id: true },
    });
    return rows.map((v) => v.employee_id);
  }
}
