import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Configurable drive classifiers ("drive attributes"). Each is its own small
 * lookup table with the same base shape, managed from the Drive Attributes
 * screen.
 *
 * The shared columns live on this abstract base; each concrete class only adds
 * its `@Entity` table name and a `UQ_<table>_name` uniqueness constraint (the
 * constraint must be declared per concrete class so each table gets its own).
 */
export abstract class DriveLookupBase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  // Manual display order in the Drive Attributes list and pickers.
  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

@Entity({ name: 'drive_designations' })
@Unique('UQ_drive_designations_name', ['name'])
export class DriveDesignation extends DriveLookupBase {}

@Entity({ name: 'drive_job_locations' })
@Unique('UQ_drive_job_locations_name', ['name'])
export class DriveJobLocation extends DriveLookupBase {}

/**
 * Offer types additionally carry the internship / full-time flags, so a drive
 * filter can ask "is this an internship offer?" without matching on the name.
 * At least one flag is always set — enforced in the service, since the rule is
 * kind-dependent and the DTO is shared across all three kinds.
 */
@Entity({ name: 'drive_offer_types' })
@Unique('UQ_drive_offer_types_name', ['name'])
export class DriveOfferType extends DriveLookupBase {
  @Column({ type: 'boolean', default: false })
  is_internship: boolean;

  @Column({ type: 'boolean', default: false })
  is_full_time: boolean;
}

/**
 * Placement categories band a drive by CTC. The band is two numeric bounds
 * rather than a display string, so a drive's package can resolve its category
 * by comparison instead of name-matching. Bounds are min-inclusive /
 * max-exclusive and NULL means open-ended, so "<5L" is (null, 5) and ">10L" is
 * (10, null). At least one bound is always set — a category with neither bands
 * every drive. Enforced in the service, since the rule is kind-dependent and
 * the DTO is shared across all kinds.
 *
 * Postgres returns `numeric` as a string, and this codebase types those columns
 * as strings rather than reaching for a transformer.
 */
@Entity({ name: 'drive_placement_categories' })
@Unique('UQ_drive_placement_categories_name', ['name'])
export class DrivePlacementCategory extends DriveLookupBase {
  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  min_lpa: string | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, nullable: true })
  max_lpa: string | null;
}

/**
 * The set of configurable lookup kinds, keyed by the URL segment the Drive
 * Attributes controller accepts. The whitelist keeps the parameterised `:type`
 * endpoint explicit and greppable (no dynamic entity resolution).
 */
export const DRIVE_LOOKUP_KINDS = [
  'designations',
  'job-locations',
  'offer-types',
  'placement-categories',
] as const;

export type DriveLookupKind = (typeof DRIVE_LOOKUP_KINDS)[number];
