import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  BLOCKING_LEAVE_STATUSES,
  StudentLeave,
  StudentLeaveStatus,
} from '../../leaves/entities/student-leave.entity';
import { ApprovalRequest } from '../../requests/entities/approval-request.entity';
import {
  ApprovalRequestTypeHandler,
  DecidedStatus,
  DecisionInput,
  DecisionResult,
  RequestDecider,
  RequestRequesterRef,
  RequestTypeRegistry,
} from '../../requests/request-type.registry';
import { StorageService } from '../../storage/storage.service';
import { LeaveAttendanceSyncService } from './leave-attendance-sync.service';
import {
  formatLeaveWhen,
  LEAVE_APPLY_TYPE,
  LeaveApplyPayload,
  LeaveAttachmentView,
  LeaveImpact,
  LEAVES_REQUEST_MODULE,
} from './leave-payloads';

const BLOCKING_LABEL: Partial<Record<StudentLeaveStatus, string>> = {
  pending: 'awaiting approval',
  approved: 'approved',
  cancel_requested: 'approved, cancellation pending',
};

/**
 * The `leave_apply` request type — a student asking for leave over a date
 * range, decided by their attendance group's in-charges. Owns the
 * `student_leaves` row through the framework's lifecycle hooks:
 *
 *   onRaised        → insert the row (pending), stamp `leave_id` into payload
 *   onResubmitted   → copy the revised dates/type/reason/files onto the row
 *   onCancelled     → row becomes `withdrawn`
 *   applyDecision   → `approved` (+ flip absent→leave on marked sessions) or
 *                     `rejected`
 *
 * Whole-request decisions only — there is nothing to approve "partially".
 */
@Injectable()
export class LeaveApplyHandler
  implements ApprovalRequestTypeHandler, OnModuleInit
{
  readonly type = LEAVE_APPLY_TYPE;
  readonly routing = 'attendance_group_incharges' as const;
  readonly catalog = {
    module: LEAVES_REQUEST_MODULE,
    label: 'Leave Application',
    order: 10,
    requester: 'student' as const,
  };

  constructor(
    @InjectRepository(StudentLeave)
    private readonly leaves: Repository<StudentLeave>,
    private readonly registry: RequestTypeRegistry,
    private readonly storage: StorageService,
    private readonly sync: LeaveAttendanceSyncService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async assertCreatable(
    tx: EntityManager,
    requester: RequestRequesterRef,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.assertNoOverlap(
      tx,
      requester.id,
      payload as LeaveApplyPayload,
      null,
    );
  }

  async assertResubmittable(
    tx: EntityManager,
    requester: RequestRequesterRef,
    request: ApprovalRequest,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.assertNoOverlap(
      tx,
      requester.id,
      payload as LeaveApplyPayload,
      request.id,
    );
  }

  /**
   * One leave per date at a time: a new range may not touch any of the
   * student's pending / approved / cancellation-pending leaves. Rejected,
   * withdrawn and cancelled ones free their dates.
   *
   * Two partial-day leaves on the same date are fine as long as their clock
   * windows don't overlap — a morning appointment and an afternoon one are
   * separate requests. A full-day leave on either side blocks the whole date.
   */
  private async assertNoOverlap(
    tx: EntityManager,
    studentId: number,
    payload: LeaveApplyPayload,
    excludeRequestId: number | null,
  ): Promise<void> {
    const qb = tx
      .getRepository(StudentLeave)
      .createQueryBuilder('sl')
      .where('sl.student_id = :sid', { sid: studentId })
      .andWhere('sl.status IN (:...st)', { st: [...BLOCKING_LEAVE_STATUSES] })
      .andWhere('sl.from_date <= :to AND sl.to_date >= :from', {
        from: payload.from_date,
        to: payload.to_date,
      })
      .andWhere(
        `(sl.from_time IS NULL OR CAST(:fromTime AS time) IS NULL
          OR (sl.from_time < CAST(:toTime AS time)
              AND sl.to_time > CAST(:fromTime AS time)))`,
        { fromTime: payload.from_time, toTime: payload.to_time },
      )
      .orderBy('sl.from_date', 'ASC');
    if (excludeRequestId !== null) {
      qb.andWhere(
        '(sl.apply_request_id IS NULL OR sl.apply_request_id != :rid)',
        { rid: excludeRequestId },
      );
    }
    const clash = await qb.getOne();
    if (clash) {
      throw new ConflictException(
        `You already have a leave covering ${formatLeaveWhen(clash.from_date, clash.to_date, clash.from_time, clash.to_time)} ` +
          `(${BLOCKING_LABEL[clash.status] ?? clash.status}).`,
      );
    }
  }

  async onRaised(
    tx: EntityManager,
    request: ApprovalRequest,
  ): Promise<Record<string, unknown>> {
    if (request.requester_student_id === null) {
      throw new InternalServerErrorException(
        'leave_apply raised without a student requester',
      );
    }
    const p = request.payload as LeaveApplyPayload;
    const repo = tx.getRepository(StudentLeave);
    const row = await repo.save(
      repo.create({
        student_id: request.requester_student_id,
        leave_type_id: p.leave_type.id,
        from_date: p.from_date,
        to_date: p.to_date,
        from_time: p.from_time,
        to_time: p.to_time,
        reason: p.reason,
        attachments: p.attachments,
        status: 'pending',
        apply_request_id: request.id,
      }),
    );
    return { ...p, leave_id: row.id };
  }

  async onResubmitted(
    tx: EntityManager,
    request: ApprovalRequest,
  ): Promise<void> {
    const p = request.payload as LeaveApplyPayload;
    await tx.getRepository(StudentLeave).update(
      { apply_request_id: request.id, status: 'pending' },
      {
        leave_type_id: p.leave_type.id,
        from_date: p.from_date,
        to_date: p.to_date,
        from_time: p.from_time,
        to_time: p.to_time,
        reason: p.reason,
        attachments: p.attachments,
      },
    );
  }

  async onCancelled(
    tx: EntityManager,
    request: ApprovalRequest,
  ): Promise<void> {
    await tx
      .getRepository(StudentLeave)
      .update(
        { apply_request_id: request.id, status: 'pending' },
        { status: 'withdrawn' },
      );
  }

  async applyDecision(
    tx: EntityManager,
    request: ApprovalRequest,
    input: DecisionInput,
    decider: RequestDecider,
  ): Promise<DecisionResult> {
    if ('verdicts' in input) {
      throw new BadRequestException(
        'Leave requests are decided as a whole — per-item verdicts are not supported.',
      );
    }
    if (input.overrides !== undefined) {
      throw new BadRequestException(
        'Leave requests do not accept edits on approval.',
      );
    }

    const repo = tx.getRepository(StudentLeave);
    const leave = await repo
      .createQueryBuilder('sl')
      .setLock('pessimistic_write')
      .where('sl.apply_request_id = :rid', { rid: request.id })
      .getOne();
    if (!leave) {
      throw new InternalServerErrorException(
        `No leave row for request ${request.id}`,
      );
    }
    if (leave.status !== 'pending') {
      throw new ConflictException('This leave is no longer awaiting approval.');
    }

    const now = new Date();
    if (input.verdict === 'approved') {
      await repo.update(
        { id: leave.id },
        {
          status: 'approved',
          decided_at: now,
          decided_by_employee_id: decider.employee_id,
        },
      );
      // Sessions already marked while the request sat in the queue: the
      // student's `absent` becomes `leave`. Future sessions pick it up live
      // at marking time (LeavesReadService).
      await this.sync.flip(tx, {
        studentId: leave.student_id,
        from: leave.from_date,
        to: leave.to_date,
        fromTime: leave.from_time,
        toTime: leave.to_time,
        fromStatus: 'absent',
        toStatus: 'leave',
        reason: `leave:${leave.id}`,
        actorEmployeeId: decider.employee_id,
      });
    } else {
      await repo.update(
        { id: leave.id },
        {
          status: 'rejected',
          decided_at: now,
          decided_by_employee_id: decider.employee_id,
        },
      );
    }

    const p = request.payload as LeaveApplyPayload;
    return { status: input.verdict, payload: { ...p, outcome: input.verdict } };
  }

  /** Presigned attachment URLs + attendance impact for the approver's view. */
  async enrichPayloadForView(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const p = payload as LeaveApplyPayload;
    const attachments: LeaveAttachmentView[] = await Promise.all(
      (p.attachments ?? []).map(async (a) => {
        try {
          return { ...a, url: await this.storage.getCachedReadUrl(a.key) };
        } catch {
          return a;
        }
      }),
    );
    let impact: LeaveImpact | undefined;
    if (p.leave_id !== undefined) {
      const leave = await this.leaves.findOne({
        where: { id: p.leave_id },
        select: { id: true, student_id: true },
      });
      if (leave) {
        impact = await this.sync.impactFor(
          leave.student_id,
          p.from_date,
          p.to_date,
          p.from_time,
          p.to_time,
        );
      }
    }
    return { ...p, attachments, ...(impact ? { impact } : {}) };
  }

  decisionNotification(
    request: ApprovalRequest,
    status: DecidedStatus,
    note: string | null,
  ): { title: string; body: string } {
    const p = request.payload as LeaveApplyPayload;
    const range = formatLeaveWhen(
      p.from_date,
      p.to_date,
      p.from_time,
      p.to_time,
    );
    const suffix = note ? ` Note: ${note}` : '';
    return status === 'approved'
      ? {
          title: 'Leave approved',
          body: `Your ${p.leave_type.name} for ${range} has been approved.${suffix}`,
        }
      : {
          title: 'Leave rejected',
          body: `Your ${p.leave_type.name} request for ${range} was rejected.${suffix}`,
        };
  }
}
