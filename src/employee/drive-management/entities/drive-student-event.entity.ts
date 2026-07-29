import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DriveStudent } from './drive-student.entity';

/**
 * One entry in a drive-student's audit trail — a status change or action,
 * append-only, powering the employee-side track view.
 *
 * `actor_type` is `'employee' | 'student' | 'system'`; `actor_employee_id` is
 * set only for employee actions (audit-only, no FK — the acting employee may be
 * deactivated later). `reason` carries the denial/revoke reason when present.
 */
@Entity({ name: 'drive_student_events' })
@Index('IDX_drive_student_events_drive_student_id', [
  'drive_student_id',
  'created_at',
])
export class DriveStudentEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  drive_student_id: number;

  @ManyToOne(() => DriveStudent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'drive_student_id' })
  drive_student: DriveStudent;

  @Column({ type: 'varchar', length: 24 })
  action: string;

  @Column({ type: 'smallint', nullable: true })
  from_status: number | null;

  @Column({ type: 'smallint' })
  to_status: number;

  @Column({ type: 'varchar', length: 12 })
  actor_type: string;

  @Column({ type: 'int', nullable: true })
  actor_employee_id: number | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  reason: string | null;

  @CreateDateColumn()
  created_at: Date;
}
