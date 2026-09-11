import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SUBJECT_CODE_MESSAGE, SUBJECT_CODE_REGEX } from './create-subject.dto';

// regulation_id is intentionally not editable here — a subject's regulation
// is fixed at creation. subject_type IS editable.
export const UpdateSubjectSchema = z
  .object({
    subject_type_id: z.coerce.number().int().positive().optional(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(SUBJECT_CODE_REGEX, SUBJECT_CODE_MESSAGE))
      .optional(),
    name: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export class UpdateSubjectDto extends createZodDto(UpdateSubjectSchema) {}
