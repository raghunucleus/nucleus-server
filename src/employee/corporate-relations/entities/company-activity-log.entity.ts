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
import { Company } from './company.entity';

export const ACTIVITY_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'status_changed',
  'assigned',
  'logo_updated',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_ENTITY_TYPES = [
  'company',
  'interaction',
  'milestone',
  'contact',
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/** One structured field diff carried on a company-master edit. */
export interface ActivityChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Append-only audit trail for a company: one row per mutation across the whole
 * CRM (master-field edits, status changes, officer reassignment, logo updates,
 * and every interaction / milestone / contact create/edit/delete). Powers the
 * unified Activity tab. `employee_id` is the acting employee (who made the
 * change) — distinct from the sub-resource's own `logged_by` creator.
 */
@Entity({ name: 'company_activity_log' })
@Index('IDX_company_activity_log_company_id', ['company_id'])
@Index('IDX_company_activity_log_company_id_created_at', [
  'company_id',
  'created_at',
])
export class CompanyActivityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  company_id: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  // Who performed the change.
  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  // ACTIVITY_ACTIONS — DTO/service-enforced.
  @Column({ type: 'varchar', length: 32 })
  action: string;

  // ACTIVITY_ENTITY_TYPES — which sub-resource the change touched.
  @Column({ type: 'varchar', length: 24 })
  entity_type: string;

  // The affected sub-resource row id; null for company-level entries.
  @Column({ type: 'int', nullable: true })
  entity_id: number | null;

  @Column({ type: 'text' })
  summary: string;

  // Structured field diffs for company-master edits; null otherwise.
  @Column({ type: 'jsonb', nullable: true })
  changes: ActivityChange[] | null;

  @CreateDateColumn()
  created_at: Date;
}
