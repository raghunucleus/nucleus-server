import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { GENDERS } from '../../../admin/entities/student.entity';
import {
  DRIVE_AMOUNT_MODES,
  DRIVE_FIELD_SCOPES,
  DRIVE_PROFILE_TYPES,
  DRIVE_STATUSES,
} from '../entities/drive.entity';

// Local helpers mirroring `corporate-relations/dto/company.dto.ts`.
//
// Note: no `enumOf` wrapper here. That helper casts to `[string, ...string[]]`,
// which widens the inferred type to `string` and costs the literal union the
// service needs to discriminate on. Zod 4's `z.enum` takes a readonly array
// directly and keeps the literals.
const dateStr = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .optional()
  .nullable();
// `registration_end_date` is a precise instant — an ISO 8601 datetime with an
// offset (the client sends the absolute moment, e.g. from a datetime-local
// input converted via `toISOString()`).
const dateTimeStr = z
  .string()
  .trim()
  .datetime({ offset: true })
  .optional()
  .nullable();
const idArray = z.array(z.coerce.number().int().positive()).optional();
const optId = z.coerce.number().int().positive().optional().nullable();

/**
 * Rich text — a Lexical `SerializedEditorState`. Held opaque on purpose: the
 * server never interprets the tree, so validating its inner shape would only
 * couple us to a Lexical version. `null` is the canonical empty (the editor
 * normalises an emptied box to null rather than an empty-paragraph blob), and it
 * is a real value here — clearing a JD is an edit, not an omission.
 */
const richText = z.record(z.string(), z.unknown()).optional().nullable();

/** A money field, bounded so a typo can't overflow `numeric(12,2)`. */
const amount = z.coerce
  .number()
  .min(0)
  .max(9_999_999_999)
  .optional()
  .nullable();

/**
 * The switchable fields, shared by the drive (when its scope is 'drive') and by
 * each profile (when it is 'designation'). Which side must be populated can't be
 * decided here — it depends on the drive's `*_scope`, which a per-object schema
 * can't see — so the service owns that rule.
 */
const scopedFields = {
  offer_type_id: optId,
  job_location_ids: idArray,
  placement_category_ids: idArray,

  has_bond: z.coerce.boolean().optional().nullable(),
  bond_years: z.coerce.number().int().min(0).max(99).optional().nullable(),
  bond_desc: richText,

  // Stipend/CTC follow `offer_type_scope`; they get no switch of their own.
  stipend_mode: z.enum(DRIVE_AMOUNT_MODES).optional().nullable(),
  stipend_min: amount,
  stipend_max: amount,
  ctc_mode: z.enum(DRIVE_AMOUNT_MODES).optional().nullable(),
  ctc_min: amount,
  ctc_max: amount,
};

/**
 * One designation within the drive. `id` is present when editing an existing
 * profile and absent when adding one: the service reconciles this array against
 * the stored rows by id, so an omitted profile is a delete.
 *
 * `designation_id` and `jd` are always per-profile; the scoped fields apply only
 * when the drive scopes them to 'designation'.
 */
export const DriveProfileSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  designation_id: z.coerce.number().int().positive(),
  jd: richText,
  sort_order: z.coerce.number().int().min(0).optional(),
  ...scopedFields,
});

/**
 * Create a drive. Every cross-field rule lives in the service, where the offer
 * type's flags and the drive's scopes are both known:
 *  - stipend is allowed iff the offer type `is_internship`;
 *  - CTC is allowed iff it `is_full_time`;
 *  - a 'drive'-scoped field must be set here and absent on the profiles (and the
 *    reverse for 'designation');
 *  - `profile_type: 'single'` permits exactly one profile.
 */
export const CreateDriveSchema = z.object({
  company_id: z.coerce.number().int().positive(),
  drive_name: z.string().trim().min(1).max(255),
  profile_type: z.enum(DRIVE_PROFILE_TYPES),
  // Lifecycle state — defaults to 'draft' on create. Transitions past 'draft'
  // are guarded in the service (see DRIVE_STATUS_TRANSITIONS).
  status: z.enum(DRIVE_STATUSES).optional(),

  offer_type_scope: z.enum(DRIVE_FIELD_SCOPES),
  job_location_scope: z.enum(DRIVE_FIELD_SCOPES),
  placement_category_scope: z.enum(DRIVE_FIELD_SCOPES),
  bond_scope: z.enum(DRIVE_FIELD_SCOPES),

  company_category_ids: idArray,

  spoc_email: z.email().max(255).optional().nullable(),
  spoc_contact: z.string().trim().max(32).optional().nullable(),
  registration_end_date: dateTimeStr,
  drive_date: dateStr,

  ...scopedFields,

  profiles: z.array(DriveProfileSchema).min(1),
});
export class CreateDriveDto extends createZodDto(CreateDriveSchema) {}

/**
 * Edit a drive. `.partial()` applies at the top level only — `profiles`, when
 * present, is the complete desired set (the service adds/updates/deletes to
 * match), never a patch of individual rows.
 */
export const UpdateDriveSchema = CreateDriveSchema.partial();
export class UpdateDriveDto extends createZodDto(UpdateDriveSchema) {}

/** Move a drive's lifecycle status (transition guarded in DrivesService). */
export const DriveStatusSchema = z.object({ status: z.enum(DRIVE_STATUSES) });
export class DriveStatusDto extends createZodDto(DriveStatusSchema) {}

/**
 * A drive's eligibility. Every axis is optional and an empty array / null means
 * "no restriction on it". Percentages are 0–100; the Btech CGPA is a 0–10 point
 * scale. Entry types are the `students.entry_type` codes (1 = Regular,
 * 2 = Lateral).
 */
export const DriveEligibilitySchema = z.object({
  programme_ids: idArray,
  entry_types: z.array(z.coerce.number().int().min(1).max(2)).optional(),
  genders: z.array(z.enum(GENDERS)).optional(),
  passout_years: z.array(z.coerce.number().int().min(1900).max(3000)).optional(),
  allow_backlog_history: z.coerce.boolean().optional(),
  max_current_backlogs: z.coerce.number().int().min(0).max(99).optional().nullable(),
  min_tenth_percentage: z.coerce.number().min(0).max(100).optional().nullable(),
  min_twelfth_or_diploma_percentage: z.coerce
    .number()
    .min(0)
    .max(100)
    .optional()
    .nullable(),
  min_btech_cgpa: z.coerce.number().min(0).max(10).optional().nullable(),
});
export class UpdateDriveEligibilityDto extends createZodDto(
  DriveEligibilitySchema,
) {}

export const DRIVE_SORT_FIELDS = [
  'drive_name',
  'company_name',
  'drive_date',
  'registration_end_date',
  'created_at',
  'status',
] as const;

/**
 * Query-string arrays arrive as repeated keys (`?x=a&x=b`) or a comma list
 * (`?x=a,b`). Normalise both to a trimmed string[] before validating.
 */
const toStringArray = (v: unknown): string[] | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const cleaned = arr.map((x) => String(x).trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
};

/** Same as `toStringArray`, then coerced to a list of positive integer ids. */
const toIntArray = (v: unknown): number[] | undefined => {
  const arr = toStringArray(v);
  if (!arr) return undefined;
  const nums = arr.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return nums.length ? nums : undefined;
};

/** A query-string id list — repeated keys or a comma list → number[]. */
export const queryIdArray = z.preprocess(
  toIntArray,
  z.array(z.number().int().positive()).optional(),
);

/** List filters. `search` matches the drive name or its company's name. */
export const DriveQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  company_id: z.coerce.number().int().positive().optional(),
  statuses: z.preprocess(
    toStringArray,
    z.array(z.enum(DRIVE_STATUSES)).optional(),
  ),
  // Multi-select facet filters. Each narrows the list only when non-empty; an
  // absent filter adds no SQL (see DrivesService.list).
  company_ids: queryIdArray,
  offer_type_ids: queryIdArray,
  placement_category_ids: queryIdArray,
  company_category_ids: queryIdArray,
  sort_by: z.enum(DRIVE_SORT_FIELDS).default('drive_date'),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export class DriveQueryDto extends createZodDto(DriveQuerySchema) {}
