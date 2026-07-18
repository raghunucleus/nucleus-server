import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Student } from '../../../admin/entities/student.entity';

/**
 * The common approval-status axis every student-facing approval shares — the
 * same vocabulary as the employee `approval_requests` framework. A module maps
 * its own (possibly richer) lifecycle onto these; only the core status lands
 * here.
 */
export const STUDENT_APPROVAL_STATUSES = [
  'pending',
  'sent_back',
  'approved',
  'rejected',
  'cancelled',
] as const;
export type StudentApprovalStatus = (typeof STUDENT_APPROVAL_STATUSES)[number];

/** Modules that currently feed the student approvals inbox. */
export const STUDENT_APPROVAL_MODULE_PLACEMENTS = 'placements';
export const STUDENT_APPROVAL_TYPE_DRIVE_INVITE = 'drive_invite';

/**
 * A single thing sent to a student for a decision, plus its common core status.
 *
 * This table is a module-agnostic INDEX + status mirror — it deliberately does
 * NOT store a module's granular lifecycle (a placement drive keeps its numeric
 * 10…80 codes in `drive_students`). Each owning module upserts the matching row
 * on every transition that changes the core status, keyed by `(module, ref_id)`
 * so the write is idempotent. The rich display payload and the full audit trail
 * stay with the module; the read endpoint hydrates from there.
 */
@Entity({ name: 'student_approvals' })
@Unique('UQ_student_approvals_module_ref', ['module', 'ref_id'])
@Index('IDX_student_approvals_student_id_status', ['student_id', 'status'])
export class StudentApproval {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // The source module + sub-type, e.g. 'placements' / 'drive_invite'.
  @Column({ type: 'varchar', length: 32 })
  module: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  // The owning module's record key — for placements this is drive_students.id.
  @Column({ type: 'int' })
  ref_id: number;

  // One of STUDENT_APPROVAL_STATUSES — the module keeps this in sync.
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  // Set once the item leaves `pending`; null while still awaiting a decision.
  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  // Denial / revoke reason snapshot, when the row is terminal.
  @Column({ type: 'varchar', length: 512, nullable: true })
  reason: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
