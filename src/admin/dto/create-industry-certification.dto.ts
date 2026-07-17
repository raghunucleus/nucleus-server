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
export const optionalIssuingBody = optionalText(128, 'Issuing body');

// Same normalise-then-validate shape as optionalText, plus a URL check that
// only runs once the value has survived as a non-empty string — a blank box on
// an optional field must not be an error. z.url() alone accepts mailto:/ftp:,
// so the protocol is pinned explicitly.
export const optionalWebsite = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (typeof v === 'string' ? v.trim() : v))
  .transform((v) => (v === '' ? null : v))
  .superRefine((v, ctx) => {
    if (typeof v !== 'string') return;
    if (v.length > 255) {
      ctx.addIssue({
        code: 'custom',
        message: 'Website must be at most 255 characters',
      });
      return;
    }
    if (!/^https?:\/\//i.test(v) || !z.url().safeParse(v).success) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid URL starting with http:// or https://',
      });
    }
  });

export const CreateIndustryCertificationSchema = z
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
    issuing_body: optionalIssuingBody,
    website: optionalWebsite,
  })
  .strict();

export class CreateIndustryCertificationDto extends createZodDto(
  CreateIndustryCertificationSchema,
) {}
