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
import { Department } from '../../../admin/entities/department.entity';
import { Employee } from '../../../admin/entities/employee.entity';
import {
  CompanyCategory,
  CompanyHiringMode,
  CompanyIndustry,
  CompanyRole,
  CompanySize,
  CompanySource,
  CompanyTag,
  CompanyType,
} from './company-lookups.entity';

// Fixed single-value enums — stable domain values that drive UI/logic, not
// user-configured lookups. Enforced at the DTO layer (stored as varchar, per
// the employees.gender convention).
export const OWNERSHIP_TYPES = ['public', 'private', 'government'] as const;
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number];

export const COMPANY_TIERS = ['A', 'B', 'C'] as const;
export type CompanyTier = (typeof COMPANY_TIERS)[number];

export const RELATIONSHIP_STATUSES = [
  'prospect',
  'active',
  'dormant',
  'strategic',
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

/**
 * A recruiting company in the placement / corporate-relations CRM. The
 * categorical classifiers (categories, industries, types, sizes, sources,
 * roles, hiring modes, tags) are all multi-select and live in join tables
 * managed by these ManyToMany relations; the join rows reference existing
 * lookup rows, so none of the relations cascades inserts.
 *
 * Ownership pivots on `responsible_employee_id` (a single officer): the
 * Companies officer surface filters every query to this column, while the
 * Company Management surface (placement manager) is unscoped.
 */
@Entity({ name: 'companies' })
@Unique('UQ_companies_name', ['name'])
@Index('IDX_companies_responsible_employee_id', ['responsible_employee_id'])
export class Company {
  @PrimaryGeneratedColumn()
  id: number;

  // --- Identity -----------------------------------------------------------
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  short_name: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  linkedin_url: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Storage object key for the logo (private bucket; served via presigned URL).
  @Column({ type: 'varchar', length: 512, nullable: true })
  logo_key: string | null;

  @Column({ type: 'int', nullable: true })
  founded_year: number | null;

  @Column({ type: 'numeric', precision: 2, scale: 1, nullable: true })
  glassdoor_rating: string | null;

  // --- General contact (distinct from the SPOC people) --------------------
  @Column({ type: 'varchar', length: 255, nullable: true })
  general_email: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  general_phone: string | null;

  // --- Fixed single-value classifiers -------------------------------------
  @Column({ type: 'varchar', length: 16, nullable: true })
  ownership_type: string | null;

  @Column({ type: 'varchar', length: 1, nullable: true })
  tier: string | null;

  // --- Legal / registration -----------------------------------------------
  @Column({ type: 'varchar', length: 32, nullable: true })
  gstin: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  cin: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  pan: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  registration_number: string | null;

  // --- Placement-specific -------------------------------------------------
  // CTC range in the currency the college records (lakhs per annum, free scale).
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  package_min: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  package_max: string | null;

  @Column({ type: 'boolean', default: false })
  offers_internships: boolean;

  @Column({ type: 'boolean', default: false })
  offers_ppo: boolean;

  // Most recent interaction/drive date — denormalised for list sorting.
  @Column({ type: 'date', nullable: true })
  last_engaged_on: string | null;

  // --- Relationship -------------------------------------------------------
  @Column({ type: 'varchar', length: 16, default: 'prospect' })
  relationship_status: string;

  @Column({ type: 'date', nullable: true })
  partnership_since: string | null;

  // --- Primary address ----------------------------------------------------
  @Column({ type: 'varchar', length: 255, nullable: true })
  address_line1: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address_line2: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  country: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  pincode: string | null;

  // --- Ownership / lifecycle ----------------------------------------------
  @Column({ type: 'int', nullable: true })
  responsible_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL', eager: false })
  @JoinColumn({ name: 'responsible_employee_id' })
  responsible_employee: Employee | null;

  @Column({ type: 'int', nullable: true })
  created_by_employee_id: number | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // --- Multi-select classifiers (join tables) -----------------------------
  // Owner side of each ManyToMany: assigning the array and saving the company
  // reconciles the junction rows. No cascade — the lookup rows already exist.
  @ManyToMany(() => CompanyCategory)
  @JoinTable({
    name: 'company_categories_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'category_id', referencedColumnName: 'id' },
  })
  categories: CompanyCategory[];

  @ManyToMany(() => CompanyIndustry)
  @JoinTable({
    name: 'company_industries_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'industry_id', referencedColumnName: 'id' },
  })
  industries: CompanyIndustry[];

  @ManyToMany(() => CompanyType)
  @JoinTable({
    name: 'company_types_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'type_id', referencedColumnName: 'id' },
  })
  types: CompanyType[];

  @ManyToMany(() => CompanySize)
  @JoinTable({
    name: 'company_sizes_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'size_id', referencedColumnName: 'id' },
  })
  sizes: CompanySize[];

  @ManyToMany(() => CompanySource)
  @JoinTable({
    name: 'company_sources_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'source_id', referencedColumnName: 'id' },
  })
  sources: CompanySource[];

  @ManyToMany(() => CompanyHiringMode)
  @JoinTable({
    name: 'company_hiring_modes_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'hiring_mode_id', referencedColumnName: 'id' },
  })
  hiring_modes: CompanyHiringMode[];

  @ManyToMany(() => CompanyRole)
  @JoinTable({
    name: 'company_roles_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: CompanyRole[];

  @ManyToMany(() => CompanyTag)
  @JoinTable({
    name: 'company_tags_link',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags: CompanyTag[];

  // The branches the company recruits from → existing Department master.
  @ManyToMany(() => Department)
  @JoinTable({
    name: 'company_eligible_branches',
    joinColumn: { name: 'company_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'department_id', referencedColumnName: 'id' },
  })
  eligible_branches: Department[];
}
