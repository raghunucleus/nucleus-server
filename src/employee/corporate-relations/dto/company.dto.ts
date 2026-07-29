import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optStr = (max: number) =>
  z.string().trim().max(max).optional().nullable();
const idArray = z.array(z.coerce.number().int().positive()).optional();

/**
 * One job role and the employee accountable for it. `id` carries the existing
 * `company_job_roles` row on an edit so the row is updated rather than
 * recreated; it is absent/null for a role being added.
 *
 * The name is free text, normalised here (trimmed, internal whitespace
 * collapsed) so "SDE  I" and "SDE I" can't both exist on one company.
 */
export const CompanyRoleSchema = z.object({
  id: z.coerce.number().int().positive().nullable().optional(),
  role_name: z
    .string()
    .trim()
    .min(1, 'Give the role a name')
    .max(160)
    .transform((v) => v.replace(/\s+/g, ' ')),
  responsible_employee_id: z.coerce.number().int().positive(),
});

/**
 * Create/edit a company. Everything here is a PROPOSAL: creating writes a
 * `pending` company and raises an approval request; editing an approved
 * company writes nothing and stages the change on the request instead.
 *
 * `is_active` rides along because activate/deactivate is an edit like any
 * other now (the switch lives in the form, not the list) and therefore needs
 * the same sign-off. `approval_status` is never client input — only a decided
 * request moves it.
 */
export const CreateCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  website: optStr(255),
  category_ids: idArray,
  roles: z.array(CompanyRoleSchema).min(1, 'Add at least one job role'),
  /** A key returned by the logo upload endpoint; validated against the bucket. */
  logo_key: optStr(512),
  is_active: z.coerce.boolean().optional(),
});

export class CreateCompanyDto extends createZodDto(CreateCompanySchema) {}

/**
 * Edit a company. `roles` stays required — a company must always end up with
 * at least one accountable person, and a partial edit that omitted them would
 * silently mean "no change" on the one field this feature exists for.
 */
export const UpdateCompanySchema = CreateCompanySchema.partial().extend({
  roles: z.array(CompanyRoleSchema).min(1, 'Add at least one job role'),
});
export class UpdateCompanyDto extends createZodDto(UpdateCompanySchema) {}

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

/** CSV / repeated-key list of positive ints (e.g. `?category_ids=1,2`). */
const csvIntArray = z.preprocess(
  toStringArray,
  z.array(z.coerce.number().int().positive()).optional(),
);

/** Columns the client may sort the company list by (whitelist). */
export const COMPANY_SORT_FIELDS = ['name', 'updated_at'] as const;

/**
 * Filters for the company list.
 *
 * `status` maps to the tri-state `is_active`: `pending` = NULL (awaiting
 * approval). It defaults to `all` rather than `active` because a freshly
 * created company is NULL — an `active` default would hide every new company
 * from the screen that just created it.
 */
export const CompanyListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['active', 'inactive', 'pending', 'all']).default('all'),
  approval: z.enum(['pending', 'approved', 'rejected', 'all']).default('all'),
  category_ids: csvIntArray,
  sort_by: z.enum(COMPANY_SORT_FIELDS).default('updated_at'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export class CompanyListQueryDto extends createZodDto(CompanyListQuerySchema) {}
