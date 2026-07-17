import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const nullableTrimmed = (
  max: number,
  validate?: (v: string) => boolean,
  msg?: string,
) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.trim() : v))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (typeof v !== 'string') return;
      if (v.length > max) {
        ctx.addIssue({
          code: 'custom',
          message: `Must be at most ${max} characters`,
        });
        return;
      }
      if (validate && !validate(v)) {
        ctx.addIssue({ code: 'custom', message: msg ?? 'Invalid value' });
      }
    });

// Local subscriber number only — no '+' or country code. Indian rules: 10 digits, starts 6-9.
const INDIA_LOCAL_RE = /^[6-9]\d{9}$/;

// Country dial code without '+' (1–4 digits, e.g. '1', '91', '253').
const COUNTRY_CODE_RE = /^\d{1,4}$/;

export const UpdateProfileSchema = z
  .object({
    email: z.email().max(255).optional(),
    first_name: nullableTrimmed(64),
    last_name: nullableTrimmed(64),
    country_code: nullableTrimmed(
      8,
      (v) => COUNTRY_CODE_RE.test(v),
      "Country code must be digits only (e.g. '91')",
    ),
    mobile_number: nullableTrimmed(
      16,
      (v) => INDIA_LOCAL_RE.test(v),
      'Indian mobile must be 10 digits starting with 6-9',
    ),
  })
  .strict();

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
