import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Employee } from '../../../admin/entities/employee.entity';

export const EXPORT_JOB_STATUSES = [
  'pending',
  'processing',
  'ready',
  'failed',
  'expired',
] as const;
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * One asynchronous file-export job owned by an employee. The generated file
 * lives in object storage under `exports/<employeeId>/...` for 24 hours after
 * completion (`expires_at`); the hourly cleanup cron then deletes the object
 * and flips the row to `expired`, so a late download click can still be
 * answered with a precise "this export has expired" instead of a dead link.
 */
@Entity({ name: 'export_jobs' })
// (employee_id, created_at) covers the "my exports, newest first" list;
// (status, expires_at) covers the cron sweeps (expire ready rows, fail stale ones).
@Index('IDX_export_jobs_employee_id_created_at', ['employee_id', 'created_at'])
@Index('IDX_export_jobs_status_expires_at', ['status', 'expires_at'])
export class ExportJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  // Which feature produced the job (e.g. 'drive_students'). Plain varchar so
  // new sources never need a migration.
  @Column({ type: 'varchar', length: 64 })
  source: string;

  // Human context shown in lists and notifications, e.g. "Students — TCS Campus Drive".
  @Column({ type: 'varchar', length: 255 })
  label: string;

  // Opaque source-specific context (e.g. { drive_id }). No FK on purpose — the
  // referenced row may be deleted while the export lives on as a snapshot.
  @Column({ type: 'jsonb', nullable: true })
  context: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 8 })
  format: ExportFormat;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: ExportJobStatus;

  @Column({ type: 'varchar', length: 512, nullable: true })
  storage_key: string | null;

  // Download filename suggested to the browser, e.g. students-2026-07-18.xlsx.
  @Column({ type: 'varchar', length: 255, nullable: true })
  filename: string | null;

  @Column({ type: 'int', nullable: true })
  row_count: number | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
