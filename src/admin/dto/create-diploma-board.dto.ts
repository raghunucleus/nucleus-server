import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Optional free-form text. Empty strings normalise to null so we don't have to
// distinguish "empty" from "absent" downstream. Shared with the update DTO,
// where the same shape gives `null` = clear the field, absent = leave it.
function optionalText(max: number, label: string) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.trim() : v))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (typeof v === 'string' && v.length > max) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} must be at most ${max} characters`,
        });
      }
    });
}

export const optionalDescription = optionalText(2000, 'Description');

export const CreateDiplomaBoardSchema = z
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
          .regex(
            /^[A-Z0-9._-]+$/,
            'Use letters, numbers, dot, underscore, or dash',
          ),
      ),
    description: optionalDescription,
  })
  .strict();

export class CreateDiplomaBoardDto extends createZodDto(
  CreateDiplomaBoardSchema,
) {}
