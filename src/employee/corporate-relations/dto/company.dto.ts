import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  COMPANY_TIERS,
  OWNERSHIP_TYPES,
  RELATIONSHIP_STATUSES,
} from '../entities/company.entity';

const enumOf = (vals: readonly string[]) =>
  z.enum(vals as unknown as [string, ...string[]]);

const optStr = (max: number) => z.string().trim().max(max).optional().nullable();
const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .optional()
  .nullable();
const idArray = z.array(z.coerce.number().int().positive()).optional();

/**
 * Create/replace a company. The multi-select classifiers arrive as id arrays
 * (`*_ids`) and are reconciled into the join tables. Enum fields are validated
 * here; ownership isn't — the officer surface can't create companies, so this
 * DTO is only ever hit under the manage screen.
 */
export const CreateCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  short_name: optStr(120),
  website: optStr(255),
  linkedin_url: optStr(255),
  description: optStr(5000),
  founded_year: z.coerce.number().int().min(1800).max(2100).optional().nullable(),
  glassdoor_rating: z.coerce.number().min(0).max(5).optional().nullable(),
  general_email: z.string().trim().email().max(255).optional().nullable(),
  general_phone: optStr(32),
  ownership_type: enumOf(OWNERSHIP_TYPES).optional().nullable(),
  tier: enumOf(COMPANY_TIERS).optional().nullable(),
  gstin: optStr(32),
  cin: optStr(32),
  pan: optStr(32),
  registration_number: optStr(64),
  package_min: z.coerce.number().min(0).optional().nullable(),
  package_max: z.coerce.number().min(0).optional().nullable(),
  offers_internships: z.coerce.boolean().optional(),
  offers_ppo: z.coerce.boolean().optional(),
  relationship_status: enumOf(RELATIONSHIP_STATUSES).optional(),
  partnership_since: dateStr,
  address_line1: optStr(255),
  address_line2: optStr(255),
  city: optStr(120),
  state: optStr(120),
  country: optStr(120),
  pincode: optStr(16),
  responsible_employee_id: z.coerce.number().int().positive().optional().nullable(),
  category_ids: idArray,
  industry_ids: idArray,
  type_ids: idArray,
  size_ids: idArray,
  source_ids: idArray,
  hiring_mode_ids: idArray,
  role_ids: idArray,
  tag_ids: idArray,
  eligible_branch_ids: idArray,
});

export class CreateCompanyDto extends createZodDto(CreateCompanySchema) {}

/** Edit a company — every field optional; only the keys present are applied. */
export const UpdateCompanySchema = CreateCompanySchema.partial();
export class UpdateCompanyDto extends createZodDto(UpdateCompanySchema) {}

/** Activate / deactivate a company. */
export const CompanyStatusSchema = z.object({
  is_active: z.coerce.boolean(),
});
export class CompanyStatusDto extends createZodDto(CompanyStatusSchema) {}

/**
 * Query-string arrays arrive either as repeated keys (`?x=1&x=2`) or as a comma
 * list (`?x=1,2`). Normalise both to a trimmed string[] before validating.
 */
const toStringArray = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const cleaned = arr.map((x) => String(x).trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
};

/** CSV / repeated-key list of positive ints (e.g. `?industry_ids=1,2`). */
const csvIntArray = z.preprocess(
  toStringArray,
  z.array(z.coerce.number().int().positive()).optional(),
);

/** CSV / repeated-key list constrained to a fixed enum. */
const csvEnumArray = (vals: readonly string[]) =>
  z.preprocess(toStringArray, z.array(enumOf(vals)).optional());

/**
 * A query-string boolean flag. `z.coerce.boolean()` is unusable here because it
 * treats the literal string `'false'` as `true`; only an explicit truthy token
 * filters.
 */
const boolFlag = z.preprocess(
  (v) => (v === undefined ? undefined : v === true || v === 'true' || v === '1'),
  z.boolean().optional(),
);

/** Columns the client may sort the company list by (whitelist). */
export const COMPANY_SORT_FIELDS = [
  'name',
  'tier',
  'relationship_status',
  'package',
  'last_engaged_on',
  'updated_at',
] as const;

/** Filters for the manager company list (all multi-select where sensible). */
export const CompanyListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  // Classifier filters — multi-select id arrays reconciled against join tables.
  category_ids: csvIntArray,
  industry_ids: csvIntArray,
  type_ids: csvIntArray,
  size_ids: csvIntArray,
  source_ids: csvIntArray,
  hiring_mode_ids: csvIntArray,
  role_ids: csvIntArray,
  tag_ids: csvIntArray,
  eligible_branch_ids: csvIntArray,
  // Plain-column filters.
  tiers: csvEnumArray(COMPANY_TIERS),
  relationship_statuses: csvEnumArray(RELATIONSHIP_STATUSES),
  ownership_types: csvEnumArray(OWNERSHIP_TYPES),
  responsible_employee_ids: csvIntArray,
  offers_internships: boolFlag,
  offers_ppo: boolFlag,
  sort_by: z.enum(COMPANY_SORT_FIELDS).default('updated_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export class CompanyListQueryDto extends createZodDto(CompanyListQuerySchema) {}
