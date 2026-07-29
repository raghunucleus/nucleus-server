import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Filters for the CR View list.
 *
 * `passout_year_id` is REQUIRED, not optional-with-a-default: the screen's year
 * selector can never be cleared, and a year-less list would be meaningless when
 * every row's record is keyed by year. A missing year is a client bug, so it
 * should 400 rather than quietly pick one.
 *
 * Unpaginated for the same reason as {@link MyJobRoleListQuerySchema} — the list
 * is already bounded to the job roles the caller is personally accountable for.
 */
export const CrViewListQuerySchema = z.object({
  passout_year_id: z.coerce.number().int().positive(),
  search: z.string().trim().max(200).optional(),
});
export class CrViewListQueryDto extends createZodDto(CrViewListQuerySchema) {}

/** An id multi-select; the cap is a sanity bound, not a business rule. */
const idArray = (max: number) =>
  z.array(z.coerce.number().int().positive()).max(max).optional();

/**
 * Contact-row free text: optional, and a cleared textbox (`''` after trim)
 * stores as NULL rather than as an empty string.
 */
const contactText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

/**
 * The same `'' | null | valid` union the guardian DTOs use — the modal submits
 * cleared textboxes as `''`, which must read as "no value", not "bad value".
 */
const contactMobile = z
  .union([
    z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
    z.literal(''),
    z.null(),
  ])
  .optional()
  .transform((v): string | null =>
    v === undefined || v === null || v === '' ? null : v,
  );

const contactEmail = z
  .union([z.string().trim().max(255).email(), z.literal(''), z.null()])
  .optional()
  .transform((v): string | null =>
    v === undefined || v === null || v === '' ? null : v.toLowerCase(),
  );

/**
 * One HR contact. Only the name is required — any single channel can be all
 * the caller has. `hr_landline` is deliberately loose free text (STD codes,
 * extensions — same doctrine as `drives.spoc_contact`); the mobile and email
 * carry the codebase's standard formats.
 *
 * `id` present = update that row in place; absent = insert. The service
 * re-checks an echoed id belongs to this record before touching it.
 */
const CrViewContactSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  hr_name: z.string().trim().min(1, 'Give the contact a name').max(160),
  hr_designation: contactText(160),
  hr_mobile: contactMobile,
  hr_landline: contactText(32),
  hr_email: contactEmail,
  sort_order: z.coerce.number().int().min(0).optional(),
});

/**
 * The editable fields of one (job role × passout year) record.
 *
 * PATCH semantics: every key is optional and an absent key leaves that field
 * alone, so each inline cell saves exactly its own field.
 *
 * `current_status_id` and the two scalars are explicitly NULLABLE — clearing
 * is a real action, not a no-op. A record with no status renders the master
 * default, which is the same thing an unsaved (role, year) shows.
 *
 * `contacts`, when present, is the COMPLETE desired set (same semantics as a
 * drive's `profiles`): the service deletes rows absent from it, updates rows
 * echoed by id, and inserts the rest.
 *
 * `.strict()` on purpose: a client sending a field that has no column should
 * get a 400 rather than have the value silently dropped.
 */
export const UpsertCrViewRecordSchema = z
  .object({
    relationship_type_ids: idArray(50),
    current_status_id: z.coerce.number().int().positive().nullable().optional(),
    designation_ids: idArray(50),
    programme_ids: idArray(100),
    job_location_ids: idArray(50),
    next_follow_up_date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
      .nullable()
      .optional(),
    remarks: z
      .string()
      .trim()
      .max(1000)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
    contacts: z.array(CrViewContactSchema).max(20).optional(),
  })
  .strict();
export class UpsertCrViewRecordDto extends createZodDto(
  UpsertCrViewRecordSchema,
) {}
