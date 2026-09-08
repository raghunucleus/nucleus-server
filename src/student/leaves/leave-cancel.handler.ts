import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { StudentLeave } from '../../leaves/entities/student-leave.entity';
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
import { LeaveAttendanceSyncService } from './leave-attendance-sync.service';
import {
  formatLeaveWhen,
  LEAVE_CANCEL_TYPE,
  LeaveCancelPayload,
  LEAVES_REQUEST_MODULE,
} from './leave-payloads';

/**
 * The `leave_cancel` request type — a student asking to cancel an APPROVED
 * leave, decided by the same in-charges. While it is pending the leave stays
 * in effect (`cancel_requested` is an effective status); only an approval
 * lifts it and flips the marked sessions back from `leave` to `absent`.
 *
 *   onRaised        → leave becomes `cancel_requested`, remembers the request
 *   onCancelled     → (student withdrew) leave back to `approved`
 *   applyDecision   → `cancelled` (+ flip leave→absent) or back to `approved`
 */
@Injectable()
export class LeaveCancelHandler
  implements ApprovalRequestTypeHandler, OnModuleInit
{
  readonly type = LEAVE_CANCEL_TYPE;
  readonly routing = 'attendance_group_incharges' as const;
  readonly catalog = {
    module: LEAVES_REQUEST_MODULE,
    label: 'Leave Cancellation',
    order: 20,
    requester: 'student' as const,
  };

  constructor(
    @InjectRepository(StudentLeave)
    private readonly leaves: Repository<StudentLeave>,
    private readonly registry: RequestTypeRegistry,
    private readonly sync: LeaveAttendanceSyncService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Lock on the LEAVE, not the requester — two cancels of one leave must serialize. */
  lockKeyFor(
    _r: RequestRequesterRef,
    payload: Record<string, unknown>,
  ): string {
    return `leave_cancel:${(payload as LeaveCancelPayload).leave_id}`;
  }

  async assertCreatable(
    tx: EntityManager,
    requester: RequestRequesterRef,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const p = payload as LeaveCancelPayload;
    const leave = await tx
      .getRepository(StudentLeave)
      .findOne({ where: { id: p.leave_id, student_id: requester.id } });
    if (!leave) throw new NotFoundException('Leave not found');
    if (leave.status === 'cancel_requested') {
      throw new ConflictException(
        'A cancellation request for this leave is already pending.',
      );
    }
    if (leave.status !== 'approved') {
      throw new ConflictException('Only an approved leave can be cancelled.');
    }
  }

  async onRaised(tx: EntityManager, request: ApprovalRequest): Promise<void> {
    const p = request.payload as LeaveCancelPayload;
    const result = await tx
      .getRepository(StudentLeave)
      .update(
        { id: p.leave_id, status: 'approved' },
        { status: 'cancel_requested', cancel_request_id: request.id },
      );
    if (!result.affected) {
      throw new ConflictException('Only an approved leave can be cancelled.');
    }
  }

  async onCancelled(
    tx: EntityManager,
    request: ApprovalRequest,
  ): Promise<void> {
    await tx
      .getRepository(StudentLeave)
      .update(
        { cancel_request_id: request.id, status: 'cancel_requested' },
        { status: 'approved', cancel_request_id: null },
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
        'Leave cancellations are decided as a whole — per-item verdicts are not supported.',
      );
    }
    if (input.overrides !== undefined) {
      throw new BadRequestException(
        'Leave cancellations do not accept edits on approval.',
      );
    }

    const repo = tx.getRepository(StudentLeave);
    const leave = await repo
      .createQueryBuilder('sl')
      .setLock('pessimistic_write')
      .where('sl.cancel_request_id = :rid', { rid: request.id })
      .getOne();
    if (!leave) {
      throw new InternalServerErrorException(
        `No leave row for cancellation request ${request.id}`,
      );
    }
    if (leave.status !== 'cancel_requested') {
      throw new ConflictException(
        'This leave is no longer awaiting cancellation.',
      );
    }

    if (input.verdict === 'approved') {
      await repo.update(
        { id: leave.id },
        { status: 'cancelled', cancelled_at: new Date() },
      );
      // The leave no longer applies: sanctioned `leave` marks in range revert
      // to plain `absent`. Unmarked sessions simply stop pre-filling.
      await this.sync.flip(tx, {
        studentId: leave.student_id,
        from: leave.from_date,
        to: leave.to_date,
        fromTime: leave.from_time,
        toTime: leave.to_time,
        fromStatus: 'leave',
        toStatus: 'absent',
        reason: `leave_cancel:${leave.id}`,
        actorEmployeeId: decider.employee_id,
      });
    } else {
      // Cancellation refused — the leave stands. `cancel_request_id` is kept
      // so the leave's detail can show the refused attempt.
      await repo.update({ id: leave.id }, { status: 'approved' });
    }

    const p = request.payload as LeaveCancelPayload;
    return { status: input.verdict, payload: { ...p, outcome: input.verdict } };
  }

  async enrichPayloadForView(
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const p = payload as LeaveCancelPayload;
    const leave = await this.leaves.findOne({
      where: { id: p.leave_id },
      select: { id: true, student_id: true },
    });
    if (!leave) return payload;
    const impact = await this.sync.impactFor(
      leave.student_id,
      p.from_date,
      p.to_date,
      p.from_time,
      p.to_time,
    );
    return { ...p, impact };
  }

  decisionNotification(
    request: ApprovalRequest,
    status: DecidedStatus,
    note: string | null,
  ): { title: string; body: string } {
    const p = request.payload as LeaveCancelPayload;
    const range = formatLeaveWhen(
      p.from_date,
      p.to_date,
      p.from_time,
      p.to_time,
    );
    const suffix = note ? ` Note: ${note}` : '';
    return status === 'approved'
      ? {
          title: 'Leave cancelled',
          body: `Your ${p.leave_type.name} for ${range} has been cancelled as requested.${suffix}`,
        }
      : {
          title: 'Leave cancellation rejected',
          body: `Your request to cancel the ${p.leave_type.name} for ${range} was rejected — the leave remains in effect.${suffix}`,
        };
  }
}
