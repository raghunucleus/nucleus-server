import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Configurable company classifiers ("company attributes"). Each is its own
 * small lookup table with an identical shape, managed from the Company
 * Attributes screen. A company references these many-to-many (multi-select) via
 * the join tables declared on the Company entity — none of them is a single
 * column on `companies`.
 *
 * The shared columns live on this abstract base; each concrete class only adds
 * its `@Entity` table name and a `UQ_<table>_name` uniqueness constraint (the
 * constraint must be declared per concrete class so each table gets its own).
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

@Entity({ name: 'company_industries' })
@Unique('UQ_company_industries_name', ['name'])
export class CompanyIndustry extends CompanyLookupBase {}

@Entity({ name: 'company_types' })
@Unique('UQ_company_types_name', ['name'])
export class CompanyType extends CompanyLookupBase {}

@Entity({ name: 'company_sizes' })
@Unique('UQ_company_sizes_name', ['name'])
export class CompanySize extends CompanyLookupBase {}

@Entity({ name: 'company_sources' })
@Unique('UQ_company_sources_name', ['name'])
export class CompanySource extends CompanyLookupBase {}

@Entity({ name: 'company_hiring_modes' })
@Unique('UQ_company_hiring_modes_name', ['name'])
export class CompanyHiringMode extends CompanyLookupBase {}

@Entity({ name: 'company_roles' })
@Unique('UQ_company_roles_name', ['name'])
export class CompanyRole extends CompanyLookupBase {}

@Entity({ name: 'company_tags' })
@Unique('UQ_company_tags_name', ['name'])
export class CompanyTag extends CompanyLookupBase {}

/**
 * The set of configurable lookup kinds, keyed by the URL segment the Company
 * Attributes controller accepts. The whitelist keeps the parameterised
 * `:type` endpoint explicit and greppable (no dynamic entity resolution).
 */
export const COMPANY_LOOKUP_KINDS = [
  'categories',
  'industries',
  'types',
  'sizes',
  'sources',
  'hiring-modes',
  'roles',
  'tags',
] as const;

export type CompanyLookupKind = (typeof COMPANY_LOOKUP_KINDS)[number];
