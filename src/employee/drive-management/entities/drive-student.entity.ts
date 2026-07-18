import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Student } from '../../../admin/entities/student.entity';
import { Drive } from './drive.entity';

/**
 * A student imported into a drive — the drive's persisted shortlist and the
 * carrier of their placement lifecycle for that drive. The Filter tab is a live
 * query over all students; adding a row here pins a candidate to the drive.
 *
 * `UQ_drive_students_drive_id_student_id` enforces "imported once": re-importing
 * the same student is a no-op the service reports as `already_existed`. Both FKs
 * CASCADE — the membership is a part of the drive and follows the student, not an
 * independent record.
 *
 * `status` is a NUMERIC code with gaps of 10 (see drive-student-status.ts —
 * deliberate, user-confirmed deviation from the string-status convention):
 * 10 imported → 20 invited → { 30 accepted | 40 denied } → 30 → { 50 not
 * attended | 60 selected | 70 not selected }. Transitions are enforced by
 * status-guarded UPDATEs in the services, never by trusting the client.
 */
@Entity({ name: 'drive_students' })
@Unique('UQ_drive_students_drive_id_student_id', ['drive_id', 'student_id'])
@Index('IDX_drive_students_student_id_status', ['student_id', 'status'])
@Index('IDX_drive_students_drive_id_status', ['drive_id', 'status'])
export class DriveStudent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  drive_id: number;

  @ManyToOne(() => Drive, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'drive_id' })
  drive: Drive;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // Who ran the import. Nullable — kept for audit, not integrity.
  @Column({ type: 'int', nullable: true })
  imported_by_employee_id: number | null;

  @CreateDateColumn()
  imported_at: Date;

  // --- Lifecycle (see drive-student-status.ts) ----------------------------
  @Column({ type: 'smallint', default: 10 })
  status: number;

  @Column({ type: 'timestamp', nullable: true })
  invited_at: Date | null;

  // Audit-only, no FK — matches imported_by_employee_id.
  @Column({ type: 'int', nullable: true })
  invited_by_employee_id: number | null;

  // When the student accepted (30) or denied (40).
  @Column({ type: 'timestamp', nullable: true })
  responded_at: Date | null;

  // Required when the student denies; student input, so bounded.
  @Column({ type: 'varchar', length: 512, nullable: true })
  rejection_reason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  outcome_marked_at: Date | null;

  @Column({ type: 'int', nullable: true })
  outcome_marked_by_employee_id: number | null;

  // Set when an employee revokes the candidate (status 80). The revoke reason
  // reuses `rejection_reason` above — a row is either denied or revoked.
  @Column({ type: 'timestamp', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'int', nullable: true })
  revoked_by_employee_id: number | null;
}
