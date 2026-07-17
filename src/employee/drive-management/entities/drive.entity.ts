import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../corporate-relations/entities/company.entity';
import { CompanyCategory } from '../../corporate-relations/entities/company-lookups.entity';
import {
  DriveJobLocation,
  DriveOfferType,
  DrivePlacementCategory,
} from './drive-lookups.entity';

// Fixed single-value enums — stable domain values that drive UI/logic, not
// user-configured lookups. Stored as varchar and enforced at the DTO layer, per
// the `companies.relationship_status` convention.

/**
 * Whether the drive hires for one designation or several. A `single` drive still
 * has exactly one `DriveProfile` row, so there is no second code path — the flag
 * only bounds how many profiles are allowed.
 */
export const DRIVE_PROFILE_TYPES = ['single', 'multi'] as const;
export type DriveProfileType = (typeof DRIVE_PROFILE_TYPES)[number];

/**
 * Where a field's value is captured. `drive` = once for the whole drive (read
 * from the column on this entity); `designation` = separately on each
 * `DriveProfile` (the column here stays NULL, and vice versa).
 *
 * Each scoped field carries its own switch, so a drive can (say) post one job
 * location for everyone while letting the offer type vary per designation.
 */
export const DRIVE_FIELD_SCOPES = ['drive', 'designation'] as const;
export type DriveFieldScope = (typeof DRIVE_FIELD_SCOPES)[number];

/** Whether a package is a single figure or a min–max band. */
export const DRIVE_AMOUNT_MODES = ['fixed', 'range'] as const;
export type DriveAmountMode = (typeof DRIVE_AMOUNT_MODES)[number];

/**
 * The drive's lifecycle state. A free set (any value at any time, membership
 * enforced at the DTO layer) rather than a guarded transition machine — the
 * placement team moves a drive through these as they see fit.
 */
export const DRIVE_STATUSES = [
  'draft',
  'ready_to_publish',
  'published',
  'archived',
] as const;
export type DriveStatus = (typeof DRIVE_STATUSES)[number];

/**
 * A placement drive a company runs on campus.
 *
 * Four fields — offer type, job location, placement category and bond — can be
 * captured either once for the drive or per designation; `*_scope` decides which,
 * and the matching columns below are populated only in the `drive` case. The
 * per-designation values live on {@link DriveProfile}.
 *
 * The package fields (stipend / CTC) deliberately have NO scope switch of their
 * own: they follow `offer_type_scope`, because a package is meaningless without
 * the offer type that says whether it's a stipend or a CTC at all.
 *
 * Applicability of the package fields derives from the selected offer type's
 * `is_internship` / `is_full_time` flags — never from its name. See
 * `DrivesService`.
 *
 * Postgres returns `numeric` as a string, and this codebase types those columns
 * as strings rather than reaching for a transformer.
 */
@Entity({ name: 'drives' })
@Index('IDX_drives_company_id', ['company_id'])
@Index('IDX_drives_drive_date', ['drive_date'])
@Index('IDX_drives_status', ['status'])
export class Drive {
  @PrimaryGeneratedColumn()
  id: number;

  // --- Identity -----------------------------------------------------------
  @Column({ type: 'int' })
  company_id: number;

  @ManyToOne(() => Company, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'varchar', length: 255 })
  drive_name: string;

  @Column({ type: 'varchar', length: 16, default: 'single' })
  profile_type: DriveProfileType;

  // Lifecycle state — see DRIVE_STATUSES. Free-set from the drive detail screen.
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: DriveStatus;

  // --- Scope switches -----------------------------------------------------
  // `offer_type_scope` also governs the stipend / CTC columns.
  @Column({ type: 'varchar', length: 16, default: 'drive' })
  offer_type_scope: DriveFieldScope;

  @Column({ type: 'varchar', length: 16, default: 'drive' })
  job_location_scope: DriveFieldScope;

  @Column({ type: 'varchar', length: 16, default: 'drive' })
  placement_category_scope: DriveFieldScope;

  @Column({ type: 'varchar', length: 16, default: 'drive' })
  bond_scope: DriveFieldScope;

  // --- Drive-level values (set only when the matching scope is 'drive') ----
  @Column({ type: 'int', nullable: true })
  offer_type_id: number | null;

  @ManyToOne(() => DriveOfferType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'offer_type_id' })
  offer_type: DriveOfferType | null;

  @Column({ type: 'boolean', nullable: true })
  has_bond: boolean | null;

  @Column({ type: 'int', nullable: true })
  bond_years: number | null;

  // Rich text — Lexical `SerializedEditorState`. NULL when empty (never an
  // empty-paragraph blob); the editor's OnChangePlugin normalises that.
  @Column({ type: 'jsonb', nullable: true })
  bond_desc: unknown;

  // Stipend applies only when the offer type is an internship.
  @Column({ type: 'varchar', length: 8, nullable: true })
  stipend_mode: DriveAmountMode | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  stipend_min: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  stipend_max: string | null;

  // CTC applies only when the offer type is a full-time role.
  @Column({ type: 'varchar', length: 8, nullable: true })
  ctc_mode: DriveAmountMode | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  ctc_min: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  ctc_max: string | null;

  // --- SPOC + dates -------------------------------------------------------
  @Column({ type: 'varchar', length: 255, nullable: true })
  spoc_email: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  spoc_contact: string | null;

  @Column({ type: 'date', nullable: true })
  registration_end_date: string | null;

  @Column({ type: 'date', nullable: true })
  drive_date: string | null;

  // --- Lifecycle ----------------------------------------------------------
  @Column({ type: 'int', nullable: true })
  created_by_employee_id: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // --- Multi-select classifiers (join tables) -----------------------------
  // Owner side of each ManyToMany: assigning the array and saving the drive
  // reconciles the junction rows. No cascade — the lookup rows already exist.

  /**
   * The drive's own company categories, seeded from the company's `categories`
   * at create time but editable afterwards — a drive can be pitched differently
   * from how the CRM classifies the company overall.
   */
  @ManyToMany(() => CompanyCategory)
  @JoinTable({
    name: 'drive_company_categories_link',
    joinColumn: { name: 'drive_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  company_categories: CompanyCategory[];

  /** Drive-level job locations — used only when `job_location_scope = 'drive'`. */
  @ManyToMany(() => DriveJobLocation)
  @JoinTable({
    name: 'drive_job_locations_link',
    joinColumn: { name: 'drive_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'job_location_id', referencedColumnName: 'id' },
  })
  job_locations: DriveJobLocation[];

  /**
   * Drive-level placement categories — used only when
   * `placement_category_scope = 'drive'`.
   */
  @ManyToMany(() => DrivePlacementCategory)
  @JoinTable({
    name: 'drive_placement_categories_link',
    joinColumn: { name: 'drive_id', referencedColumnName: 'id' },
    inverseJoinColumn: {
      name: 'placement_category_id',
      referencedColumnName: 'id',
    },
  })
  placement_categories: DrivePlacementCategory[];
}
