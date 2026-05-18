import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ACADEMIC_LEVELS } from '../entities/degree.entity';

export const CreateDegreeSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((v) => v.toUpperCase())
      .pipe(
        z
          .string()
          .regex(/^[A-Z0-9._-]+$/, 'Use letters, numbers, dot, underscore, or dash'),
      ),
    short_name: z.string().trim().min(1).max(64),
    academic_level: z.enum(ACADEMIC_LEVELS),
    duration_years: z.coerce.number().int().min(1).max(8),
  })
  .strict();

export class CreateDegreeDto extends createZodDto(CreateDegreeSchema) {}
