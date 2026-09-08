import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AttendanceGroupIncharge } from '../../admin/entities/attendance-group-incharge.entity';
import { LeaveType } from '../../admin/entities/leave-type.entity';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { Student } from '../../admin/entities/student.entity';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import {
  LeaveAttachment,
  STUDENT_LEAVE_STATUSES,
  StudentLeave,
  StudentLeaveStatus,
} from '../../leaves/entities/student-leave.entity';
import { ApprovalRequestsService } from '../../requests/approval-requests.service';
import {
  ApprovalRequest,
  OPEN_APPROVAL_REQUEST_STATUSES,
} from '../../requests/entities/approval-request.entity';
import { isStudentLeaveAttachmentKey } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';
import { CreateStudentLeaveDto } from './dto/create-student-leave.dto';
import {
  inclusiveDays,
  LEAVE_APPLY_TYPE,
  LEAVE_CANCEL_TYPE,
  LeaveApplyPayload,
  LeaveAttachmentView,
  LeaveCancelPayload,
} from './leave-payloads';

/** A linked approval request as the leave screens show it. */
export interface LeaveRequestRef {
  id: number;
  status: string;
  decision_note: string | null;
  decided_at: Date | null;
}

export interface StudentLeaveView {
  id: number;
  status: StudentLeaveStatus;
  leave_type: { id: number; name: string };
  from_date: string;
  to_date: string;
  /** Partial-day window ('HH:MM:SS'), or both null for a full day. */
  from_time: string | null;
  to_time: string | null;
  days: number;
  reason: string | null;
  attachments: LeaveAttachmentView[];
  apply_request: LeaveRequestRef | null;
  cancel_request: LeaveRequestRef | null;
  decided_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** A pending apply or cancel request exists that the student may withdraw. */
  can_withdraw: boolean;
  /** The leave is approved and no cancellation is pending. */
  can_request_cancel: boolean;
  /** The apply request was sent back — the student may revise and resubmit. */
  can_revise: boolean;
}

export interface LeaveContext {
  leave_types: { id: number; name: string }[];
  /** The batch's current semester — the client warns when dates fall outside it. */
  semester: {
    id: number;
    name: string | null;
    planned_start_date: string | null;
    planned_end_date: string | null;
  } | null;
  group: { id: number; name: string } | null;
  incharges: { id: number; emp_display_name: string }[];
  can_apply: boolean;
  /** Why `can_apply` is false — same copy the framework's 422 would carry. */
  blocker: string | null;
}

export type LeaveStatusCounts = Record<StudentLeaveStatus, number>;

/**
 * Student-facing surface of the leaves domain: the read views, and the thin
 * write layer that builds payloads and hands them to the approval-requests
 * framework (which in turn calls back into the handlers to keep the
 * `student_leaves` row in step). Every method takes the student id from the
 * controller (JWT) — never from the request.
 */
@Injectable()
export class StudentLeavesService {
  constructor(
    @InjectRepository(StudentLeave)
    private readonly leaves: Repository<StudentLeave>,
    @InjectRepository(LeaveType)
    private readonly leaveTypes: Repository<LeaveType>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(StudentGroup)
    private readonly studentGroups: Repository<StudentGroup>,
    @InjectRepository(AttendanceGroupIncharge)
    private readonly groupIncharges: Repository<AttendanceGroupIncharge>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    private readonly approvalRequests: ApprovalRequestsService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async context(studentId: number): Promise<LeaveContext> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const [leaveTypes, membership, ps] = await Promise.all([
      this.leaveTypes.find({
        where: { is_active: true },
        order: { name: 'ASC' },
        select: { id: true, name: true },
      }),
      this.studentGroups
        .createQueryBuilder('sg')
        .leftJoinAndSelect('sg.attendance_group', 'g')
        .where('sg.student_id = :sid', { sid: studentId })
        .getOne(),
      this.findCurrentPs(student),
    ]);

    const group = membership?.attendance_group ?? null;
    const incharges = group
      ? await this.groupIncharges
          .createQueryBuilder('gi')
          .innerJoin('gi.employee', 'e')
          .select('e.id', 'id')
          .addSelect('e.emp_display_name', 'emp_display_name')
          .where('gi.attendance_group_id = :g', { g: group.id })
          .orderBy('e.emp_display_name', 'ASC')
          .getRawMany<{ id: number | string; emp_display_name: string }>()
      : [];

    let blocker: string | null = null;
    if (!group) {
      blocker =
        'You are not assigned to an attendance group yet. Please contact the college office.';
    } else if (incharges.length === 0) {
      blocker =
        'No in-charge is assigned to your attendance group yet. Please contact the college office.';
    } else if (leaveTypes.length === 0) {
      blocker =
        'Leave types are not set up yet. Please contact the college office.';
    }

    return {
      leave_types: leaveTypes.map((t) => ({ id: t.id, name: t.name })),
      semester: ps
        ? {
            id: ps.id,
            name: ps.semester?.name ?? null,
            planned_start_date: ps.planned_start_date,
            planned_end_date: ps.planned_end_date,
          }
        : null,
      group: group ? { id: group.id, name: group.name } : null,
      incharges: incharges.map((i) => ({
        id: Number(i.id),
        emp_display_name: i.emp_display_name,
      })),
      can_apply: blocker === null,
      blocker,
    };
  }

  async list(
    studentId: number,
    status?: StudentLeaveStatus,
  ): Promise<StudentLeaveView[]> {
    const qb = this.baseQuery().where('sl.student_id = :sid', {
      sid: studentId,
    });
    if (status) qb.andWhere('sl.status = :status', { status });
    const rows = await qb
      .orderBy('sl.from_date', 'DESC')
      .addOrderBy('sl.id', 'DESC')
      .getMany();
    return rows.map((r) => this.toView(r));
  }

  async counts(studentId: number): Promise<LeaveStatusCounts> {
    const rows = await this.leaves
      .createQueryBuilder('sl')
      .select('sl.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('sl.student_id = :sid', { sid: studentId })
      .groupBy('sl.status')
      .getRawMany<{ status: StudentLeaveStatus; count: string }>();
    const counts = Object.fromEntries(
      STUDENT_LEAVE_STATUSES.map((s) => [s, 0]),
    ) as LeaveStatusCounts;
    for (const r of rows) counts[r.status] = Number(r.count);
    return counts;
  }

  /** One leave with presigned attachment URLs. 404 when not the student's own. */
  async getOne(studentId: number, leaveId: number): Promise<StudentLeaveView> {
    const row = await this.requireOwn(studentId, leaveId);
    const view = this.toView(row);
    view.attachments = await Promise.all(
      view.attachments.map(async (a) => {
        try {
          return { ...a, url: await this.storage.getCachedReadUrl(a.key) };
        } catch {
          return a;
        }
      }),
    );
    return view;
  }

  // ---------------------------------------------------------------------------
  // Writes — all go through the approval-requests framework
  // ---------------------------------------------------------------------------

  /** File a leave application; the handler creates the leave row inside the framework tx. */
  async apply(
    studentId: number,
    dto: CreateStudentLeaveDto,
  ): Promise<StudentLeaveView> {
    const payload = await this.buildApplyPayload(studentId, dto);
    const request = await this.approvalRequests.createForStudent(
      studentId,
      LEAVE_APPLY_TYPE,
      payload,
      dto.reason ?? null,
    );
    const leaveId = (request.payload as LeaveApplyPayload).leave_id;
    if (leaveId === undefined) {
      // onRaised always stamps it; treat its absence as a bug, not a 404.
      throw new ConflictException('Leave was filed but could not be loaded.');
    }
    return this.getOne(studentId, leaveId);
  }

  /** Revise a sent-back application and put it back in the in-charges' queue. */
  async resubmit(
    studentId: number,
    leaveId: number,
    dto: CreateStudentLeaveDto,
  ): Promise<StudentLeaveView> {
    const leave = await this.requireOwn(studentId, leaveId);
    if (leave.status !== 'pending' || leave.apply_request_id === null) {
      throw new ConflictException(
        'Only a leave application that was sent back to you can be revised.',
      );
    }
    const payload = await this.buildApplyPayload(studentId, dto, leave.id);
    // The framework 409s unless the request is currently `sent_back`.
    await this.approvalRequests.resubmitForStudent(
      studentId,
      leave.apply_request_id,
      LEAVE_APPLY_TYPE,
      payload,
      dto.reason ?? null,
    );
    return this.getOne(studentId, leaveId);
  }

  /**
   * Withdraw whichever request is open on this leave: the application (leave
   * pending) or the cancellation (leave approved, cancellation pending). The
   * handlers' `onCancelled` hooks move the leave row accordingly.
   */
  async withdraw(
    studentId: number,
    leaveId: number,
  ): Promise<StudentLeaveView> {
    const leave = await this.requireOwn(studentId, leaveId);
    if (leave.status === 'pending' && leave.apply_request_id !== null) {
      await this.approvalRequests.cancelForStudent(
        studentId,
        leave.apply_request_id,
      );
    } else if (
      leave.status === 'cancel_requested' &&
      leave.cancel_request_id !== null
    ) {
      await this.approvalRequests.cancelForStudent(
        studentId,
        leave.cancel_request_id,
      );
    } else {
      throw new ConflictException(
        'There is no pending request on this leave to withdraw.',
      );
    }
    return this.getOne(studentId, leaveId);
  }

  /** Ask the in-charges to cancel an approved leave. */
  async requestCancel(
    studentId: number,
    leaveId: number,
    reason: string | undefined,
  ): Promise<StudentLeaveView> {
    const leave = await this.requireOwn(studentId, leaveId);
    if (leave.status === 'cancel_requested') {
      throw new ConflictException(
        'A cancellation request for this leave is already pending.',
      );
    }
    if (leave.status !== 'approved') {
      throw new ConflictException('Only an approved leave can be cancelled.');
    }
    const payload: LeaveCancelPayload = {
      v: 1,
      leave_id: leave.id,
      leave_type: { id: leave.leave_type.id, name: leave.leave_type.name },
      from_date: leave.from_date,
      to_date: leave.to_date,
      from_time: leave.from_time,
      to_time: leave.to_time,
      days: inclusiveDays(leave.from_date, leave.to_date),
      reason: reason ?? null,
    };
    await this.approvalRequests.createForStudent(
      studentId,
      LEAVE_CANCEL_TYPE,
      payload,
      reason ?? null,
    );
    return this.getOne(studentId, leaveId);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Validate the form against the masters and the object store, and snapshot
   * the leave type's name so approver UIs never join lookups. `leaveId` is
   * carried through on resubmit so the payload keeps pointing at its row.
   */
  private async buildApplyPayload(
    studentId: number,
    dto: CreateStudentLeaveDto,
    leaveId?: number,
  ): Promise<LeaveApplyPayload> {
    const type = await this.leaveTypes.findOne({
      where: { id: dto.leave_type_id, is_active: true },
    });
    if (!type) {
      throw new BadRequestException('Selected leave type is not available.');
    }

    const attachments: LeaveAttachment[] = [];
    for (const a of dto.attachments) {
      // Ownership is proven by the key's folder (`student-leaves/<id>/…`) —
      // a key outside it is someone else's file or a forged path.
      if (!isStudentLeaveAttachmentKey(a.key, studentId)) {
        throw new BadRequestException(
          `Attachment "${a.name}" was not uploaded for this account.`,
        );
      }
      if (!(await this.storage.objectExists(a.key))) {
        throw new BadRequestException(
          `Attachment "${a.name}" could not be found — upload it again.`,
        );
      }
      attachments.push({
        key: a.key,
        name: a.name,
        mime: a.mime,
        size: a.size,
      });
    }

    return {
      v: 1,
      ...(leaveId !== undefined ? { leave_id: leaveId } : {}),
      leave_type: { id: type.id, name: type.name },
      from_date: dto.from_date,
      to_date: dto.to_date,
      from_time: dto.from_time ?? null,
      to_time: dto.to_time ?? null,
      days: inclusiveDays(dto.from_date, dto.to_date),
      reason: dto.reason ?? null,
      attachments,
    };
  }

  private baseQuery() {
    return this.leaves
      .createQueryBuilder('sl')
      .leftJoinAndSelect('sl.leave_type', 'lt')
      .leftJoinAndSelect('sl.apply_request', 'ar')
      .leftJoinAndSelect('sl.cancel_request', 'cr');
  }

  private async requireOwn(
    studentId: number,
    leaveId: number,
  ): Promise<StudentLeave> {
    const row = await this.baseQuery()
      .where('sl.id = :id', { id: leaveId })
      .andWhere('sl.student_id = :sid', { sid: studentId })
      .getOne();
    // 404 on someone else's leave — never reveal that the id exists.
    if (!row) throw new NotFoundException('Leave not found');
    return row;
  }

  private toView(row: StudentLeave): StudentLeaveView {
    const isOpen = (r: ApprovalRequest | null): boolean =>
      r !== null &&
      (OPEN_APPROVAL_REQUEST_STATUSES as readonly string[]).includes(r.status);
    const ref = (r: ApprovalRequest | null): LeaveRequestRef | null =>
      r
        ? {
            id: r.id,
            status: r.status,
            decision_note: r.decision_note,
            decided_at: r.decided_at,
          }
        : null;
    return {
      id: row.id,
      status: row.status,
      leave_type: { id: row.leave_type.id, name: row.leave_type.name },
      from_date: row.from_date,
      to_date: row.to_date,
      from_time: row.from_time,
      to_time: row.to_time,
      days: inclusiveDays(row.from_date, row.to_date),
      reason: row.reason,
      attachments: row.attachments ?? [],
      apply_request: ref(row.apply_request),
      cancel_request: ref(row.cancel_request),
      decided_at: row.decided_at,
      cancelled_at: row.cancelled_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      can_withdraw:
        (row.status === 'pending' && isOpen(row.apply_request)) ||
        (row.status === 'cancel_requested' && isOpen(row.cancel_request)),
      can_request_cancel: row.status === 'approved',
      can_revise:
        row.status === 'pending' && row.apply_request?.status === 'sent_back',
    };
  }

  /**
   * The batch's current semester, or null. Same ranking as
   * StudentPortalService.findCurrentPs (ongoing → completed → other), which is
   * private to the student module and can't be imported here without a cycle.
   */
  private async findCurrentPs(
    student: Student,
  ): Promise<ProgrammeSemester | null> {
    return this.programmeSemesters
      .createQueryBuilder('ps')
      .leftJoinAndSelect('ps.semester', 'semester')
      .where('ps.programme_id = :pid', { pid: student.programme_id })
      .andWhere('ps.admission_year_id = :ayid', {
        ayid: student.admission_year_id,
      })
      .andWhere('ps.is_active = TRUE')
      .orderBy(
        `CASE WHEN ps.status = 'ongoing' THEN 0 WHEN ps.status = 'completed' THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy('ps.updated_at', 'DESC')
      .getOne();
  }
}
