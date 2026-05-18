import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Bulk-link multiple semesters to a (programme, admission year) batch in one
// request. The service skips combinations that already exist and reports both
// what was created and what was skipped, so the same form submission is safe
// to retry without duplicate-key errors.
export const BulkCreateProgrammeSemestersSchema = z
  .object({
    programme_id: z.coerce.number().int().positive(),
    admission_year_id: z.coerce.number().int().positive(),
    semester_ids: z
      .array(z.coerce.number().int().positive())
      .min(1, 'Pick at least one semester')
      .max(32, 'Too many semesters in one request'),
  })
  .strict();

export class BulkCreateProgrammeSemestersDto extends createZodDto(
  BulkCreateProgrammeSemestersSchema,
) {}
