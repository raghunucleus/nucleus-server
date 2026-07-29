import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Configurable company classifiers ("company attributes"), managed from the
 * Company Attributes screen.
 *
 * Category is the survivor of the original eight (industry, type, size, source,
 * hiring mode, role, tag went with the rest of the company CRM) — it stays
 * because drive-management tags its drives against the same master
 * (`drive_company_categories_link`). It classifies the COMPANY.
 *
 * Relationship type and current status are different: they classify what the
 * responsible person recorded for one job role in one passout year, so the
 * selected values live on `company_job_role_years`, not on `companies`. Only
 * the option lists are managed here.
 *
 * The base class stays abstract so adding a kind is one class plus an entry in
 * {@link COMPANY_LOOKUP_KINDS} — the controller, service and the frontend
 * lookup editor are all already parameterised by kind.
 */
export abstract class CompanyLookupBase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  // Manual display order in the Company Attributes list and pickers.
  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

@Entity({ name: 'company_categories' })
@Unique('UQ_company_categories_name', ['name'])
export class CompanyCategory extends CompanyLookupBase {}

/** How the college engages a company for a given year — MULTI-select. */
@Entity({ name: 'company_relationship_types' })
@Unique('UQ_company_relationship_types_name', ['name'])
export class CompanyRelationshipType extends CompanyLookupBase {}

/**
 * Where this year's conversation with a company stands — SINGLE-select, with
 * one option marked as the one a record shows before anything is recorded.
 */
@Entity({ name: 'company_current_statuses' })
@Unique('UQ_company_current_statuses_name', ['name'])
export class CompanyCurrentStatus extends CompanyLookupBase {
  /**
   * At most one row carries this. Enforced by the PARTIAL unique index
   * `UQ_company_current_statuses_default`, which has no decorator here:
   * Postgres has no partial UNIQUE *constraint*, so it can only be created in
   * the migration. Same shape as `Timetable.is_default`
   * (1780800000000-AddDefaultTimetableFlag.ts).
   *
   * The flag lives on this kind alone rather than on
   * {@link CompanyLookupBase} — "the default one" is meaningless for the
   * multi-select kinds, and it would be two more unenforced columns. Kind
   * specific fields on the subclass is the `DriveOfferType.is_internship`
   * precedent.
   *
   * DISPLAY ONLY. It is never copied into a `company_job_role_years` row: a
   * (role, year) with no status recorded renders this option, which is what
   * makes every new passout year start back at "Need to contact" with nothing
   * to reset.
   */
  @Column({ type: 'boolean', default: false })
  is_default: boolean;
}

/**
 * The set of configurable lookup kinds, keyed by the URL segment the Company
 * Attributes controller accepts. The whitelist keeps the parameterised
 * `:type` endpoint explicit and greppable (no dynamic entity resolution).
 */
export const COMPANY_LOOKUP_KINDS = [
  'categories',
  'relationship-types',
  'current-statuses',
] as const;

export type CompanyLookupKind = (typeof COMPANY_LOOKUP_KINDS)[number];
