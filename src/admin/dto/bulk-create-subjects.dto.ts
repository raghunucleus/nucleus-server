import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Every cell is an optional, trimmed string. Empty cells normalise to
// undefined. All *semantic* validation (required, code format, subject type
// lookup, duplicates) happens in the service so it can return per-row/per-field
// errors the bulk-upload grid highlights — rather than a single opaque Zod
// rejection.
const cell = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

export const BulkCreateSubjectRowSchema = z
  .object({
    subject_type: cell,
    code: cell,
    name: cell,
  })
  .strict();

export const BulkCreateSubjectsSchema = z
  .object({
    regulation_id: z.coerce.number().int().positive(),
    rows: z.array(BulkCreateSubjectRowSchema).min(1).max(1000),
  })
  .strict();

export type BulkCreateSubjectRow = z.infer<typeof BulkCreateSubjectRowSchema>;

export class BulkCreateSubjectsDto extends createZodDto(
  BulkCreateSubjectsSchema,
) {}
