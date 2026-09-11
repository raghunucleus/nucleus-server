import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Shared with update-subject + the bulk upload service.
export const SUBJECT_CODE_REGEX = /^[A-Z0-9._-]+$/;
export const SUBJECT_CODE_MESSAGE =
  'Use letters, numbers, dot, underscore, or dash';

export const CreateSubjectSchema = z
  .object({
    regulation_id: z.coerce.number().int().positive(),
    subject_type_id: z.coerce.number().int().positive(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(SUBJECT_CODE_REGEX, SUBJECT_CODE_MESSAGE)),
    name: z.string().trim().min(1).max(255),
  })
  .strict();

export class CreateSubjectDto extends createZodDto(CreateSubjectSchema) {}
