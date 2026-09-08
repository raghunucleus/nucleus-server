import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateLeaveTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
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
  })
  .strict();

export class UpdateLeaveTypeDto extends createZodDto(UpdateLeaveTypeSchema) {}
