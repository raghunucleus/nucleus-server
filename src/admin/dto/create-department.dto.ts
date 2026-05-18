import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateDepartmentSchema = z
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
  })
  .strict();

export class CreateDepartmentDto extends createZodDto(CreateDepartmentSchema) {}
