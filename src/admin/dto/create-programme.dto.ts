import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateProgrammeSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
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
    display_name: z.string().trim().min(1).max(128),
    degree_id: z.coerce.number().int().positive(),
    department_id: z.coerce.number().int().positive(),
  })
  .strict();

export class CreateProgrammeDto extends createZodDto(CreateProgrammeSchema) {}
