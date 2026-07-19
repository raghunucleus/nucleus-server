import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Drive } from './drive.entity';
import type { DriveStatus } from './drive.entity';

/**
 * One entry in a drive's status audit trail — a lifecycle transition, append
 * only, powering the Overview "Status history" timeline. Modelled on
 * `drive_student_events`.
 *
 * `from_status` is null for the drive's first recorded change (its earlier
 * history predates this table). `actor_employee_id` is the acting employee —
 * audit-only, deliberately NO FK, since the employee may be deactivated later.
 */
@Entity({ name: 'drive_status_events' })
@Index('IDX_drive_status_events_drive_id', ['drive_id', 'created_at'])
export class DriveStatusEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  drive_id: number;

  @ManyToOne(() => Drive, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'drive_id' })
  drive: Drive;

  @Column({ type: 'varchar', length: 16, nullable: true })
  from_status: DriveStatus | null;

  @Column({ type: 'varchar', length: 16 })
  to_status: DriveStatus;

  @Column({ type: 'int', nullable: true })
  actor_employee_id: number | null;

  @CreateDateColumn()
  created_at: Date;
}
