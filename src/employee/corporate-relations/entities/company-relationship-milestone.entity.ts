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

export const MILESTONE_TYPES = [
  'mou_signed',
  'partnership',
  'status_change',
  'note',
  'other',
] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

/**
 * A dated entry on a company's relationship timeline (Relationship tab) — MOU
 * signed, partnership formed, status change, or a plain note. The
 * `relationship_status` field itself lives on the company (manager-editable);
 * these milestones are the append-only history both the manager and the
 * responsible officer can record.
 */
@Entity({ name: 'company_relationship_milestones' })
@Index('IDX_company_rel_milestones_company_id', ['company_id'])
export class CompanyRelationshipMilestone {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  company_id: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @Column({ type: 'date' })
  milestone_date: string;

  // 'mou_signed' | 'partnership' | 'status_change' | 'note' | 'other'.
  @Column({ type: 'varchar', length: 16 })
  type: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @CreateDateColumn()
  created_at: Date;
}
