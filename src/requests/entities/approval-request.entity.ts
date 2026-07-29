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
import { ProgrammeAdmissionYear } from '../../admin/entities/programme-admission-year.entity';
import { Student } from '../../admin/entities/student.entity';

/**
 * Request types known to the framework. Each type's payload shape, validation
 * and apply-on-approve behaviour live in that type's own module (registered
 * via RequestTypeRegistry) — this list only names them.
 */
export const APPROVAL_REQUEST_TYPES = [
  'profile_update',
  'company_approval',
] as const;
export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

/**
 * Lifecycle states. Deliberately narrow — per-item verdicts (e.g. per-field
 * outcomes on a profile update) live inside the payload, and a mixed decision
 * resolves to approved/rejected as picked by the approver. `sent_back` =
 * returned to the requester for changes; it is NOT decidable, it must come
 * back through the requester via resubmit.
 *
 *   pending   --send-back (note required)--> sent_back
 *   pending   --decide-------------------->  approved | rejected
 *   pending   --cancel-------------------->  cancelled
 *   sent_back --resubmit (new payload)---->  pending
 *   sent_back --cancel-------------------->  cancelled
 */
export const APPROVAL_REQUEST_STATUSES = [
  'pending',
  'sent_back',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

/**
 * Statuses in which a request is still alive — awaiting a decision, or parked
 * with the requester for changes. Type handlers reserve against this set (e.g.
 * profile updates lock a field while any open request touches it): a sent-back
 * request keeps its claim, otherwise a requester could raise a second request
 * for the same field while the first is mid-revision.
 */
export const OPEN_APPROVAL_REQUEST_STATUSES = ['pending', 'sent_back'] as const;

/**
 * A generic approval request — the common lifecycle row behind every
 * "X needs someone's sign-off" flow. The framework owns requester identity,
 * routing, status and decision metadata; `payload` is opaque jsonb whose shape
 * belongs to the request type's handler module.
 *
 * A requester may hold SEVERAL pending requests of one type at once — what
 * counts as a duplicate is type-specific (e.g. profile updates reject a field
 * already covered by a pending request) and is enforced by the type handler's
 * `assertCreatable` inside the create transaction, serialized by a
 * per-(requester, type) advisory lock in ApprovalRequestsService.
 */
@Entity({ name: 'approval_requests' })
@Check(
  'CHK_approval_requests_one_requester',
  'num_nonnulls("requester_student_id", "requester_employee_id") = 1',
)
@Index('IDX_approval_requests_requester_student_id', ['requester_student_id'])
@Index('IDX_approval_requests_requester_employee_id', ['requester_employee_id'])
@Index('IDX_approval_requests_pay_id_status', [
  'programme_admission_year_id',
  'status',
])
@Index('IDX_approval_requests_action_key_status', ['action_key', 'status'])
@Check(
  'CHK_approval_requests_employee_requester_action_key',
  '"requester_employee_id" IS NULL OR "action_key" IS NOT NULL',
)
export class ApprovalRequest {
  @PrimaryGeneratedColumn()
  id: number;

  // One of APPROVAL_REQUEST_TYPES — enforced at the DTO layer.
  @Column({ type: 'varchar', length: 32 })
  request_type: string;

  // One of APPROVAL_REQUEST_STATUSES — transitions enforced in the service.
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  // Polymorphic requester: exactly one of the two ids is set (DB CHECK).
  // Both CASCADE — a deleted requester takes their requests along.
  @Column({ type: 'int', nullable: true })
  requester_student_id: number | null;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requester_student_id' })
  requester_student: Student;

  @Column({ type: 'int', nullable: true })
  requester_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requester_employee_id' })
  requester_employee: Employee;

  // Opaque per-type payload — the owning module's handler defines the shape
  // (e.g. profile updates store { changes: [{ field, from, to }] }).
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  requester_note: string | null;

  // Routing scope for STUDENT requests: approvers are the profile verifiers of
  // this (programme × admission-year) batch. SET NULL — history outlives a
  // deleted batch. Null for employee-submitted requests, which route by
  // `action_key` instead.
  @Column({ type: 'int', nullable: true })
  programme_admission_year_id: number | null;

  @ManyToOne(() => ProgrammeAdmissionYear, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'programme_admission_year_id' })
  programme_admission_year: ProgrammeAdmissionYear;

  // Routing scope for EMPLOYEE requests: one of APPROVAL_ACTIONS (see
  // `src/approval-approvers/approval-actions.ts`); the approvers are whoever an
  // admin assigned to that action. Null for student requests — a DB CHECK
  // enforces that an employee requester always carries one, or the request
  // would sit in nobody's inbox.
  //
  // Deliberately NOT `request_type`: the type says what the payload IS (which
  // handler parses it), the action key says WHO DECIDES. They happen to be 1:1
  // today; conflating them would mean a type could never route two ways, and
  // re-keying an action later would retroactively re-route decided history.
  @Column({ type: 'varchar', length: 64, nullable: true })
  action_key: string | null;

  // Decision metadata — set once when the request leaves `pending` via an
  // approver action. SET NULL keeps decided history if the employee goes.
  @Column({ type: 'int', nullable: true })
  decided_by_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_employee_id' })
  decided_by_employee: Employee;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'text', nullable: true })
  decision_note: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
