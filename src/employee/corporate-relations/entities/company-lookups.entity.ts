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
 * Company Attributes screen. Category is the only one left — the other seven
 * (industry, type, size, source, hiring mode, role, tag) were dropped along
 * with the rest of the company CRM. Category survives because drive-management
 * tags its drives against the same master (`drive_company_categories_link`).
 *
 * The base class stays abstract so adding a second kind later is one class plus
 * an entry in {@link COMPANY_LOOKUP_KINDS} — the controller, service and the
 * frontend lookup editor are all already parameterised by kind.
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

/**
 * The set of configurable lookup kinds, keyed by the URL segment the Company
 * Attributes controller accepts. The whitelist keeps the parameterised
 * `:type` endpoint explicit and greppable (no dynamic entity resolution).
 */
export const COMPANY_LOOKUP_KINDS = ['categories'] as const;

export type CompanyLookupKind = (typeof COMPANY_LOOKUP_KINDS)[number];
