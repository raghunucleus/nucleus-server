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
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Drive, DriveAmountMode } from './drive.entity';
import {
  DriveDesignation,
  DriveJobLocation,
  DriveOfferType,
  DrivePlacementCategory,
} from './drive-lookups.entity';

/**
 * One designation within a drive — the "profile" in the drive's Single profile /
 * Multi profile choice. A single-profile drive has exactly one of these, so
 * reads never branch on `Drive.profile_type`.
 *
 * Named "profile" rather than "designation" because `drive_designations` is
 * already taken: that table is the master lookup this row points AT via
 * `designation_id`.
 *
 * The scoped columns mirror {@link Drive}'s and are populated only when the
 * drive's matching `*_scope` is `designation` (otherwise the value lives once on
 * the drive). `jd` and its attachments are the exception — always per-designation,
 * so they have no switch.
 */
@Entity({ name: 'drive_profiles' })
@Unique('UQ_drive_profiles_drive_id_designation_id', [
  'drive_id',
  'designation_id',
])
@Index('IDX_drive_profiles_drive_id', ['drive_id'])
export class DriveProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  drive_id: number;

  @ManyToOne(() => Drive, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'drive_id' })
  drive: Drive;

  @Column({ type: 'int' })
  designation_id: number;

  @ManyToOne(() => DriveDesignation, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'designation_id' })
  designation: DriveDesignation;

  /**
   * The job description. Rich text — Lexical `SerializedEditorState`, authored by
   * the trimmed editor on the employee web portal and rendered read-only
   * everywhere else (including React Native, which walks this JSON without the
   * Lexical runtime). NULL when empty, never an empty-paragraph blob.
   */
  @Column({ type: 'jsonb', nullable: true })
  jd: unknown;

  // Display order of the profile blocks within the drive.
  @Column({ type: 'int', default: 0 })
  sort_order: number;

  // --- Designation-level values (set only when the drive's scope says so) ---
  @Column({ type: 'int', nullable: true })
  offer_type_id: number | null;

  @ManyToOne(() => DriveOfferType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'offer_type_id' })
  offer_type: DriveOfferType | null;

  @Column({ type: 'boolean', nullable: true })
  has_bond: boolean | null;

  @Column({ type: 'int', nullable: true })
  bond_years: number | null;

  @Column({ type: 'jsonb', nullable: true })
  bond_desc: unknown;

  // Stipend / CTC follow `Drive.offer_type_scope` — they have no switch of their
  // own. Applicability derives from the offer type's is_internship /
  // is_full_time flags; see `DrivesService`.
  @Column({ type: 'varchar', length: 8, nullable: true })
  stipend_mode: DriveAmountMode | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  stipend_min: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  stipend_max: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  ctc_mode: DriveAmountMode | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  ctc_min: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  ctc_max: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  /**
   * Designation-level job locations — used only when the drive's
   * `job_location_scope = 'designation'`.
   */
  @ManyToMany(() => DriveJobLocation)
  @JoinTable({
    name: 'drive_profile_job_locations_link',
    joinColumn: { name: 'drive_profile_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'job_location_id', referencedColumnName: 'id' },
  })
  job_locations: DriveJobLocation[];

  /**
   * Designation-level placement categories — used only when the drive's
   * `placement_category_scope = 'designation'`.
   */
  @ManyToMany(() => DrivePlacementCategory)
  @JoinTable({
    name: 'drive_profile_placement_categories_link',
    joinColumn: { name: 'drive_profile_id', referencedColumnName: 'id' },
    inverseJoinColumn: {
      name: 'placement_category_id',
      referencedColumnName: 'id',
    },
  })
  placement_categories: DrivePlacementCategory[];
}
