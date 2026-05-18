import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateRegulationSchema = z
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
    year_of_regulation: z.coerce.number().int().min(1900).max(2100).optional(),
    description: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (typeof v === 'string' ? v.trim() : v))
      .transform((v) => (v === '' ? null : v))
      .superRefine((v, ctx) => {
        if (typeof v === 'string' && v.length > 2000) {
          ctx.addIssue({
            code: 'custom',
            message: 'Description must be at most 2000 characters',
          });
        }
      }),
  })
  .strict();

export class UpdateRegulationDto extends createZodDto(UpdateRegulationSchema) {}
