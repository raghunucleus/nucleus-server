import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Employee } from '../../../admin/entities/employee.entity';
import { CompanyJobRoleYear } from './company-job-role-year.entity';
import { CompanyCurrentStatus } from './company-lookups.entity';

/**
 * One status transition on a (job role × passout year) record — the CR View
 * status history. APPEND-ONLY: rows are inserted inside the record's own save
 * transaction whenever `current_status_id` actually changes, and never updated
 * or deleted individually. `status_id` is nullable because clearing back to
 * the master default is a real transition worth remembering.
 *
 * The record FK cascades (history dies with its record, the same chain as the
 * contacts child); the status FK is RESTRICT like every lookup reference here
 * (masters only deactivate); the actor FK is SET NULL — an HR deletion must
 * not block anything, and a lost name is merely lossy.
 *
 * Constraint names abbreviate to `cjry_status_logs` — spelled out they would
 * exceed the 63-byte identifier limit, per the `rel_types` precedent.
 */
@Entity({ name: 'company_job_role_year_status_logs' })
@Index('IDX_cjry_status_logs_company_job_role_year_id', [
  'company_job_role_year_id',
])
export class CompanyJobRoleYearStatusLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  company_job_role_year_id: number;

  @ManyToOne(() => CompanyJobRoleYear, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'company_job_role_year_id' })
  company_job_role_year: CompanyJobRoleYear;

  /** The status the record changed TO; `null` = cleared to the default. */
  @Column({ type: 'int', nullable: true })
  status_id: number | null;

  @ManyToOne(() => CompanyCurrentStatus, { onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'status_id' })
  status: CompanyCurrentStatus | null;

  @Column({ type: 'int', nullable: true })
  changed_by_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'changed_by_employee_id' })
  changed_by_employee: Employee | null;

  @CreateDateColumn()
  created_at: Date;
}
