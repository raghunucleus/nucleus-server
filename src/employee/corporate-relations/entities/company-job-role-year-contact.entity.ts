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
import { CompanyJobRoleYear } from './company-job-role-year.entity';

/**
 * One HR contact recorded against a (job role × passout year) — the repeatable
 * "Contact details" group on CR View. A record can hold several: companies
 * field a recruiter AND an HR ops person, and next year's drive may be a whole
 * new set, which is exactly why these hang off the year record rather than the
 * company.
 *
 * A child table rather than JSONB: every repeatable business group in this
 * codebase is a table (drive_profiles is the model), the rows carry ids the
 * client can echo back for update-in-place, and a future "search by HR name"
 * needs a column, not a blob.
 *
 * Only `hr_name` is required — a contact is useless without a name, but any
 * single channel (mobile, landline, email) can be all the caller has. Formats
 * are enforced in the DTO (`CrViewContactSchema`), not here: `hr_mobile` a
 * 10-digit Indian mobile, `hr_email` an email, `hr_landline` deliberately loose
 * free text (extensions, STD codes — same doctrine as `drives.spoc_contact`).
 *
 * PARENT-SCOPED, never global: rows are only ever written through the record's
 * PATCH, which reconciles the full set (delete absent, update by id, insert the
 * rest) after re-checking each echoed id belongs to this record. `sort_order`
 * is the array index at save time; reads tie-break on `id`.
 */
@Entity({ name: 'company_job_role_year_contacts' })
@Index('IDX_company_job_role_year_contacts_company_job_role_year_id', [
  'company_job_role_year_id',
])
export class CompanyJobRoleYearContact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  company_job_role_year_id: number;

  // CASCADE the whole chain down: the record cascades off its job role, so a
  // deleted role takes its years and their contacts with it in one statement.
  @ManyToOne(() => CompanyJobRoleYear, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'company_job_role_year_id' })
  company_job_role_year: CompanyJobRoleYear;

  @Column({ type: 'varchar', length: 160 })
  hr_name: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  hr_designation: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  hr_mobile: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  hr_landline: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  hr_email: string | null;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
