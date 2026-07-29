import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Employee } from '../../../admin/entities/employee.entity';
import { Programme } from '../../../admin/entities/programme.entity';
import {
  DriveDesignation,
  DriveJobLocation,
} from '../../drive-management/entities/drive-lookups.entity';
import { CompanyJobRole } from './company-job-role.entity';
import { CompanyJobRoleYearContact } from './company-job-role-year-contact.entity';
import {
  CompanyCurrentStatus,
  CompanyRelationshipType,
} from './company-lookups.entity';
import { PassoutYear } from './passout-year.entity';

/**
 * What the responsible person recorded for ONE job role in ONE passout year —
 * the row behind a CR View line.
 *
 * A job role at a company is a standing fact; the CR work against it is annual,
 * so anything year-specific lives here rather than on `company_job_roles`.
 *
 * MATERIALIZED LAZILY. The table starts empty and a row appears only when
 * someone actually saves against that (role, year) pair — CR View lists every
 * role the caller owns for every year and renders a missing row as "nothing
 * recorded yet". Eager materialization would be `roles × years` rows of
 * nothing (7 seeded years today = 7× the row count for zero information).
 *
 * The domain fields: relationship type(s) and current status (masters on the
 * Company Attributes screen), the designations / programmes / job locations
 * pursued this year (the Drive Attributes and academics masters — CR View
 * serves them from its own `scope()` since its holders cannot reach those
 * screens' endpoints), the next follow-up date, remarks, and the repeatable HR
 * contacts ({@link CompanyJobRoleYearContact}). Adding another scalar field is
 * one `@Column` here, one `ALTER TABLE`, and one key in
 * `UpsertCrViewRecordSchema`.
 *
 * Surrogate PK rather than a two-column primary key: the pair is hard-enforced
 * by the `@Unique` below (a real SQL constraint, per the entity conventions),
 * `repo.findOne({ where: { id } })` stays ergonomic, and a future child table
 * gets a one-column FK instead of an awkward composite.
 *
 * `company_job_role_id` is ON DELETE CASCADE, and that is deliberately lossy:
 * both {@link CorporateRelationsService.writeRoles} and
 * {@link CompanyApprovalService.applyRoles} delete roles absent from the payload
 * they are given, so removing a role from a company discards its records for
 * EVERY year. RESTRICT is not an option — it would make those edits throw. If
 * this data ever becomes precious the fix is a soft delete on
 * `company_job_roles`, not a different FK here.
 *
 * `passout_year_id` is RESTRICT and costs nothing: the master has no delete
 * path, years are only deactivated. The audit FKs are nullable ON DELETE SET
 * NULL — an HR deletion must not block anything, and a lost stamp is merely
 * lossy, unlike an ownerless job role.
 */
@Entity({ name: 'company_job_role_years' })
@Unique('UQ_company_job_role_years_company_job_role_id_passout_year_id', [
  'company_job_role_id',
  'passout_year_id',
])
@Unique('UQ_company_job_role_years_record_code', ['record_code'])
// The unique constraint's backing index already serves every lookup that leads
// with `company_job_role_id`, so the only indexes worth adding are the two FK
// columns it does not cover.
@Index('IDX_company_job_role_years_passout_year_id', ['passout_year_id'])
@Index('IDX_company_job_role_years_current_status_id', ['current_status_id'])
// A sort column on CR View ("who do I call next"), so it earns an index the
// other scalar fields do not.
@Index('IDX_company_job_role_years_next_follow_up_date', [
  'next_follow_up_date',
])
export class CompanyJobRoleYear {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  company_job_role_id: number;

  @ManyToOne(() => CompanyJobRole, { onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'company_job_role_id' })
  company_job_role: CompanyJobRole;

  @Column({ type: 'int' })
  passout_year_id: number;

  @ManyToOne(() => PassoutYear, { onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'passout_year_id' })
  passout_year: PassoutYear;

  /**
   * SINGLE-select. Nullable, and that null is meaningful: the row renders the
   * master's default status instead. It happens both before anything is chosen
   * (a record materialized by a relationship-types-only save) and after the
   * status is deliberately cleared.
   *
   * RESTRICT costs nothing — the lookup master has no delete path, values are
   * only deactivated.
   */
  @Column({ type: 'int', nullable: true })
  current_status_id: number | null;

  @ManyToOne(() => CompanyCurrentStatus, { onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'current_status_id' })
  current_status: CompanyCurrentStatus | null;

  /**
   * MULTI-select, owner side — assigning the array and saving reconciles the
   * junction rows, the same mechanism as `Company.categories`. No cascade: the
   * lookup rows already exist and must not be written through this relation.
   */
  @ManyToMany(() => CompanyRelationshipType)
  @JoinTable({
    name: 'company_job_role_year_relationship_types',
    joinColumn: {
      name: 'company_job_role_year_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: {
      name: 'relationship_type_id',
      referencedColumnName: 'id',
    },
  })
  relationship_types: CompanyRelationshipType[];

  /**
   * MULTI-selects over masters owned by OTHER screens — Drive Attributes for
   * designations and job locations, academics for programmes. Referencing
   * rather than copying: CR and drives should agree on what "Software Engineer"
   * means. RESTRICT on the lookup side (unlike the drive links, which cascade):
   * deleting a designation must not silently rewrite CR history.
   */
  @ManyToMany(() => DriveDesignation)
  @JoinTable({
    name: 'company_job_role_year_designations',
    joinColumn: {
      name: 'company_job_role_year_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: { name: 'designation_id', referencedColumnName: 'id' },
  })
  designations: DriveDesignation[];

  @ManyToMany(() => Programme)
  @JoinTable({
    name: 'company_job_role_year_programmes',
    joinColumn: {
      name: 'company_job_role_year_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: { name: 'programme_id', referencedColumnName: 'id' },
  })
  programmes: Programme[];

  @ManyToMany(() => DriveJobLocation)
  @JoinTable({
    name: 'company_job_role_year_locations',
    joinColumn: {
      name: 'company_job_role_year_id',
      referencedColumnName: 'id',
    },
    inverseJoinColumn: { name: 'job_location_id', referencedColumnName: 'id' },
  })
  job_locations: DriveJobLocation[];

  /**
   * The repeatable "Contact details" group, ordered by `sort_order` (the array
   * index at save time). Written only through the record PATCH's reconcile,
   * never through cascade on this relation.
   */
  @OneToMany(() => CompanyJobRoleYearContact, (c) => c.company_job_role_year)
  contacts: CompanyJobRoleYearContact[];

  /**
   * The record's human-readable reference key — `CR-<passout year>-<id
   * zero-padded to 5>`, e.g. `CR-2027-00042`. Unique by construction (the
   * number IS the primary key) and IMMUTABLE once assigned: other modules
   * (drive management, spreadsheets, chat) will quote it, and a reference key
   * must survive company/role renames — which is why it is NOT derived from
   * names. Nullable in the schema only because it is stamped right after the
   * insert, in the same transaction; every persisted row carries one.
   */
  @Column({ type: 'varchar', length: 24, nullable: true })
  record_code: string | null;

  /** 'YYYY-MM-DD' — Postgres `date` comes back as a string, kept as one. */
  @Column({ type: 'date', nullable: true })
  next_follow_up_date: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  remarks: string | null;

  @Column({ type: 'int', nullable: true })
  created_by_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'created_by_employee_id' })
  created_by_employee: Employee | null;

  @Column({ type: 'int', nullable: true })
  updated_by_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'updated_by_employee_id' })
  updated_by_employee: Employee | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
