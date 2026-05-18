import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateSemesterSchema = z
  .object({
    sem_number: z.coerce.number().int().min(1).max(16).optional(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .transform((v) => v.toUpperCase())
      .pipe(
        z
          .string()
          .regex(/^[A-Z0-9._-]+$/, 'Use letters, numbers, dot, underscore, or dash'),
      )
      .optional(),
    name: z.string().trim().min(1).max(64).optional(),
    year_sem_format: z.string().trim().min(1).max(16).optional(),
    roman_format: z.string().trim().min(1).max(8).optional(),
  })
  .strict();

export class UpdateSemesterDto extends createZodDto(UpdateSemesterSchema) {}
