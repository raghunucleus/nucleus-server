import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { Student } from '../../admin/entities/student.entity';
import { ApprovalRequest } from './approval-request.entity';

/**
 * What happened to a request. Mirrors the lifecycle transitions in
 * {@link APPROVAL_REQUEST_STATUSES} plus the two requester-side moves that
 * don't leave a distinct status behind (`raised`, `resubmitted`).
 *
 * Note there is no `partially_approved` — a mixed decision resolves to the
 * approver's explicit `overall` pick, and the per-item verdicts ride along in
 * `detail`.
 */
export const APPROVAL_REQUEST_EVENTS = [
  'raised',
  'resubmitted',
  'sent_back',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type ApprovalRequestEventKind = (typeof APPROVAL_REQUEST_EVENTS)[number];

/** Who caused an event. `system` is reserved for future automated actions. */
export const APPROVAL_REQUEST_ACTOR_KINDS = [
  'student',
  'employee',
  'system',
] as const;
export type ApprovalRequestActorKind =
  (typeof APPROVAL_REQUEST_ACTOR_KINDS)[number];

/**
 * One append-only entry in a request's history. The request row itself only
 * ever holds its CURRENT state — `status` is overwritten on every transition
 * and `decided_*` records a single decision — so this table is the only place
 * that remembers the sequence. Written inside the same transaction as the state
 * change it describes, so a rolled-back decision leaves no trace.
 *
 * Rows are never updated or deleted by application code.
 */
@Entity({ name: 'approval_request_events' })
@Index('IDX_approval_request_events_approval_request_id', [
  'approval_request_id',
])
export class ApprovalRequestEvent {
  @PrimaryGeneratedColumn()
  id: number;

  // CASCADE — a deleted request takes its history along; the trail is
  // meaningless without the row it describes.
  @Column({ type: 'int' })
  approval_request_id: number;

  @ManyToOne(() => ApprovalRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'approval_request_id' })
  approval_request: ApprovalRequest;

  // One of APPROVAL_REQUEST_EVENTS.
  @Column({ type: 'varchar', length: 24 })
  event: string;

  /**
   * One of APPROVAL_REQUEST_ACTOR_KINDS. Denormalized deliberately: both actor
   * FKs are SET NULL so history outlives a deleted student/employee, and once
   * the id is gone this column is all that says who acted. That also rules out
   * the parent table's `num_nonnulls(...) = 1` CHECK — it would be violated the
   * moment an actor row is deleted.
   */
  @Column({ type: 'varchar', length: 8 })
  actor_kind: string;

  @Column({ type: 'int', nullable: true })
  actor_student_id: number | null;

  @ManyToOne(() => Student, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_student_id' })
  actor_student: Student;

  @Column({ type: 'int', nullable: true })
  actor_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_employee_id' })
  actor_employee: Employee;

  // The note that came with the action — send-back reason, decision note,
  // requester note on raise/resubmit.
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /**
   * Opaque per-event extra, shaped by whoever logged it — e.g. a decision
   * carries the outcome-annotated payload so the timeline can show what was
   * approved AT THAT MOMENT, even after a later resubmit rewrites
   * `approval_requests.payload`.
   */
  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at: Date;
}
