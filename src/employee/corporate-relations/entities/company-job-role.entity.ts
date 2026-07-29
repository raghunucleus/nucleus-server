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
import { Employee } from '../../../admin/entities/employee.entity';
import { Company } from './company.entity';

/**
 * One job role a company recruits for, and the employee accountable for it.
 * Most companies have exactly one row; a few have several.
 *
 * `role_name` is free text on purpose — there is no master list to keep in sync
 * with what recruiters actually call the position. It is normalised (trimmed,
 * internal whitespace collapsed) in the DTO, and the service additionally
 * rejects case-insensitive duplicates within a company; the `@Unique` below is
 * the exact-match backstop.
 *
 * `responsible_employee_id` is NOT NULL with an ON DELETE RESTRICT FK. An
 * ownerless job role is exactly the state this table exists to prevent, and
 * CASCADE would silently drop a role from a live company the moment HR deletes
 * an employee — RESTRICT forces the reassignment to be explicit. Employees are
 * deactivated far more often than deleted here, so the blast radius is small.
 */
@Entity({ name: 'company_job_roles' })
@Unique('UQ_company_job_roles_company_id_role_name', ['company_id', 'role_name'])
@Index('IDX_company_job_roles_company_id', ['company_id'])
@Index('IDX_company_job_roles_responsible_employee_id', [
  'responsible_employee_id',
])
export class CompanyJobRole {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  company_id: number;

  @ManyToOne(() => Company, (c) => c.job_roles, {
    onDelete: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'varchar', length: 160 })
  role_name: string;

  @Column({ type: 'int' })
  responsible_employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'responsible_employee_id' })
  responsible_employee: Employee;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
