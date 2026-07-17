import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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
      .pipe(
        z
          .string()
          .regex(
            /^[A-Z0-9._-]+$/,
            'Use letters, numbers, dot, underscore, or dash',
          ),
      ),
    name: z.string().trim().min(1).max(255),
  })
  .strict();

export class CreateSubjectDto extends createZodDto(CreateSubjectSchema) {}
