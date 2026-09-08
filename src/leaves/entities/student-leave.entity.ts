import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { LeaveType } from '../../admin/entities/leave-type.entity';
import { Student } from '../../admin/entities/student.entity';
import { ApprovalRequest } from '../../requests/entities/approval-request.entity';

/**
 *   pending          --apply approved-->              approved
 *   pending          --apply rejected-->              rejected
 *   pending          --student withdraws request-->   withdrawn
 *   approved         --cancel requested-->            cancel_requested
 *   cancel_requested --cancel approved-->             cancelled
 *   cancel_requested --cancel rejected / withdrawn--> approved
 */
export const STUDENT_LEAVE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'cancel_requested',
  'cancelled',
] as const;
export type StudentLeaveStatus = (typeof STUDENT_LEAVE_STATUSES)[number];

/**
 * Statuses in which a leave is IN EFFECT for attendance: marking pre-fills
 * `leave` for the student on these dates and derived displays show "Leave".
 * A pending cancellation does NOT lift the leave — only an approved one does.
 */
export const EFFECTIVE_LEAVE_STATUSES = [
  'approved',
  'cancel_requested',
] as const satisfies readonly StudentLeaveStatus[];

/** Statuses that reserve a date range — a new application may not overlap them. */
export const BLOCKING_LEAVE_STATUSES = [
  'pending',
  'approved',
  'cancel_requested',
] as const satisfies readonly StudentLeaveStatus[];

/** One staged proof file. `key` is the private object key; reads are presigned. */
export interface LeaveAttachment {
  key: string;
  name: string;
  mime: string;
  size: number;
}

/**
 * A student's leave application — the domain row behind the student "Leaves"
 * module. The approval lifecycle runs through the generic `approval_requests`
 * framework (`leave_apply` raises one; `leave_cancel` asks to cancel an
 * approved one); this row is what attendance reads. Created inside the
 * framework's create transaction by the `leave_apply` handler's `onRaised`
 * hook, and kept in lock-step by the other hooks + `applyDecision`.
 *
 * A leave is whole-day unless `from_time`/`to_time` are set, in which case it
 * covers only the classes whose period run overlaps that window — see those
 * columns below.
 */
@Entity({ name: 'student_leaves' })
@Check('CHK_student_leaves_date_range', '"to_date" >= "from_date"')
// Partial-day is a single-day concept: both times set or both NULL, the window
// must be non-empty, and it may not straddle a multi-day range.
@Check(
  'CHK_student_leaves_partial_window',
  `("from_time" IS NULL) = ("to_time" IS NULL)
   AND ("from_time" IS NULL
        OR ("to_time" > "from_time" AND "from_date" = "to_date"))`,
)
@Index('IDX_student_leaves_student_id_status', ['student_id', 'status'])
@Index('IDX_student_leaves_from_date_to_date', ['from_date', 'to_date'])
@Index('IDX_student_leaves_apply_request_id', ['apply_request_id'])
@Index('IDX_student_leaves_cancel_request_id', ['cancel_request_id'])
export class StudentLeave {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'int' })
  leave_type_id: number;

  @ManyToOne(() => LeaveType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'leave_type_id' })
  leave_type: LeaveType;

  // Inclusive calendar range, 'YYYY-MM-DD'.
  @Column({ type: 'date' })
  from_date: string;

  @Column({ type: 'date' })
  to_date: string;

  // Partial-day window — PG `time`, handed back as 'HH:MM:SS'. Both NULL on a
  // full-day leave, which is the common case. When set (single-day only, per
  // CHK_student_leaves_partial_window) the leave covers exactly those class
  // sessions whose period run overlaps [from_time, to_time): a session
  // starting at to_time is NOT covered. Sessions outside the window are
  // untouched — the student is expected in class for them.
  //
  // The window, not a list of session ids, is the stored truth: a timetable
  // republish reseeds scheduled sessions, so stored ids would dangle. The UI
  // picks classes only to derive this window; coverage is always re-derived.
  @Column({ type: 'time', nullable: true })
  from_time: string | null;

  @Column({ type: 'time', nullable: true })
  to_time: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  attachments: LeaveAttachment[];

  // One of STUDENT_LEAVE_STATUSES — transitions live in the request handlers.
  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: StudentLeaveStatus;

  // The `leave_apply` request that raised this leave. SET NULL — the leave
  // outlives a purged request.
  @Column({ type: 'int', nullable: true })
  apply_request_id: number | null;

  @ManyToOne(() => ApprovalRequest, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'apply_request_id' })
  apply_request: ApprovalRequest | null;

  // The most recent `leave_cancel` request against this leave (pending,
  // approved, or rejected — rejected/withdrawn ones may be superseded later).
  @Column({ type: 'int', nullable: true })
  cancel_request_id: number | null;

  @ManyToOne(() => ApprovalRequest, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cancel_request_id' })
  cancel_request: ApprovalRequest | null;

  // Who decided the application (approve or reject), and when.
  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'int', nullable: true })
  decided_by_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_employee_id' })
  decided_by: Employee | null;

  // Set when a cancellation request is approved.
  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
