import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ACADEMIC_LEVELS } from '../entities/degree.entity';

export const UpdateDegreeSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
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
      )
      .optional(),
    short_name: z.string().trim().min(1).max(64).optional(),
    academic_level: z.enum(ACADEMIC_LEVELS).optional(),
    duration_years: z.coerce.number().int().min(1).max(8).optional(),
  })
  .strict();

export class UpdateDegreeDto extends createZodDto(UpdateDegreeSchema) {}
