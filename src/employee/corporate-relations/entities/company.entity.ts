import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CompanyCategory } from './company-lookups.entity';
import { CompanyJobRole } from './company-job-role.entity';

/**
 * Lifecycle of a company record. Every transition out of `pending` is an
 * approval decision — see `company-approval.service.ts`.
 */
export const COMPANY_APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
] as const;
export type CompanyApprovalStatus = (typeof COMPANY_APPROVAL_STATUSES)[number];

/**
 * A recruiting company in the placement catalog — deliberately a thin record:
 * name, URL, logo, categories and its job roles. Anything richer (packages,
 * addresses, contacts) lives with the drive it belongs to, not here.
 *
 * `approval_status` / `is_active` are two separate gates:
 *  - `approval_status` — every create, edit and status change goes through an
 *    approval request routed to the `corporate_relations.company` approvers.
 *    A new company sits at `pending`; a refused creation lands at `rejected`
 *    (a refused *edit* leaves an approved company alone — only the staged
 *    change is dropped).
 *  - `is_active` — NULL while `pending`/`rejected`, TRUE once approved, and
 *    TRUE/FALSE thereafter. The nullable third state is what "awaiting
 *    approval" looks like in the list. It is only ever written by an approved
 *    request, never by a direct status endpoint.
 */
@Entity({ name: 'companies' })
@Unique('UQ_companies_name', ['name'])
@Index('IDX_companies_approval_status', ['approval_status'])
export class Company {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  // Storage object key for the logo (private bucket; served via presigned URL).
  @Column({ type: 'varchar', length: 512, nullable: true })
  logo_key: string | null;

  // --- Lifecycle ------------------------------------------------------------
  // One of COMPANY_APPROVAL_STATUSES — enforced at the DTO/service layer.
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  approval_status: string;

  // No default: an INSERT that omits it lands NULL = awaiting approval.
  @Column({ type: 'boolean', nullable: true })
  is_active: boolean | null;

  @Column({ type: 'int', nullable: true })
  created_by_employee_id: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // The one surviving classifier — drive-management tags its drives with the
  // same `company_categories` master (`drive_company_categories_link`).
  // Owner side: assigning the array and saving reconciles the junction rows.
  // No cascade — the lookup rows already exist.
  @ManyToMany(() => CompanyCategory)
  @JoinTable({
    name: 'company_categories_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  categories: CompanyCategory[];

  // The job roles this company recruits for, each with its accountable
  // employee. Reconciled explicitly by the approval handler, never cascaded.
  @OneToMany(() => CompanyJobRole, (r) => r.company, { eager: false })
  job_roles: CompanyJobRole[];
}
