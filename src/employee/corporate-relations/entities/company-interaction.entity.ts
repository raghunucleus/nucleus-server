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
import { Company } from './company.entity';
import { CompanyContact } from './company-contact.entity';

export const INTERACTION_TYPES = [
  'call',
  'email',
  'meeting',
  'visit',
  'event',
  'other',
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/**
 * One logged touchpoint with a company (the CRM activity log). `interaction_date`
 * drives the month/year filter on the Interactions tab — placement engagement
 * recurs every academic year, so the officer narrows by cycle.
 */
@Entity({ name: 'company_interactions' })
@Index('IDX_company_interactions_company_id', ['company_id'])
@Index('IDX_company_interactions_company_id_date', [
  'company_id',
  'interaction_date',
])
export class CompanyInteraction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  company_id: number;

  @ManyToOne(() => Company, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  // Who logged the interaction.
  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  // 'call' | 'email' | 'meeting' | 'visit' | 'event' | 'other' — DTO-enforced.
  @Column({ type: 'varchar', length: 16 })
  type: string;

  @Column({ type: 'date' })
  interaction_date: string;

  // Optional SPOC this touchpoint was with.
  @Column({ type: 'int', nullable: true })
  contact_id: number | null;

  @ManyToOne(() => CompanyContact, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contact_id' })
  contact: CompanyContact | null;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'date', nullable: true })
  follow_up_date: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  outcome: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
