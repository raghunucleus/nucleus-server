import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { optionalDescription } from './create-entrance-exam.dto';

export const UpdateEntranceExamSchema = z
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
    // Already optional and null-accepting — pass `null` to clear, omit to keep.
    description: optionalDescription,
  })
  .strict();

export class UpdateEntranceExamDto extends createZodDto(
  UpdateEntranceExamSchema,
) {}
