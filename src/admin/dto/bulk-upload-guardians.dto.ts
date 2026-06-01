import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Each contact field is an optional, trimmed string. Empty cells normalise to
// undefined. All *semantic* validation (formats, "name required when mobile
// present", "at least one contact per row", dedup) happens in the service so
// it can return per-row/per-field errors the bulk-upload grid highlights —
// rather than a single opaque Zod rejection.
const cell = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

export const BulkUploadGuardianRowSchema = z
  .object({
    student_id: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((v) => v.toUpperCase()),
    father_name: cell,
    father_mobile: cell,
    father_email: cell,
    mother_name: cell,
    mother_mobile: cell,
    mother_email: cell,
    guardian_name: cell,
    guardian_mobile: cell,
    guardian_email: cell,
  })
  .strict();

export const BulkUploadGuardiansSchema = z
  .object({
    rows: z.array(BulkUploadGuardianRowSchema).min(1).max(1000),
  })
  .strict();

export class BulkUploadGuardiansDto extends createZodDto(
  BulkUploadGuardiansSchema,
) {}
