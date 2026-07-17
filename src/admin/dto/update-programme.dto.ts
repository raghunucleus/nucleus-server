import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateProgrammeSchema = z
  .object({
    name: z.string().trim().min(1).max(256).optional(),
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
      )
      .optional(),
    display_name: z.string().trim().min(1).max(128).optional(),
    degree_id: z.coerce.number().int().positive().optional(),
    department_id: z.coerce.number().int().positive().optional(),
  })
  .strict();

export class UpdateProgrammeDto extends createZodDto(UpdateProgrammeSchema) {}
