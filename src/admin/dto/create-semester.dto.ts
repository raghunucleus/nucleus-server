import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateSemesterSchema = z
  .object({
    sem_number: z.coerce.number().int().min(1).max(16),
    code: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .transform((v) => v.toUpperCase())
      .pipe(
        z
          .string()
          .regex(
            /^[A-Z0-9._-]+$/,
            'Use letters, numbers, dot, underscore, or dash',
          ),
      ),
    name: z.string().trim().min(1).max(64),
    year_sem_format: z.string().trim().min(1).max(16),
    roman_format: z.string().trim().min(1).max(8),
  })
  .strict();

export class CreateSemesterDto extends createZodDto(CreateSemesterSchema) {}
