import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateLeaveTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
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
  })
  .strict();

export class CreateLeaveTypeDto extends createZodDto(CreateLeaveTypeSchema) {}
