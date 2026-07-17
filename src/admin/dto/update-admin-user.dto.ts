import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const INDIA_LOCAL_RE = /^[6-9]\d{9}$/;
const COUNTRY_CODE_RE = /^\d{1,4}$/;

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

export const UpdateAdminUserSchema = z
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
    password: z.string().min(8).max(128).optional(),
  })
  .strict();

export class UpdateAdminUserDto extends createZodDto(UpdateAdminUserSchema) {}
