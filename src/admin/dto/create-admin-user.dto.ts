import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const INDIA_LOCAL_RE = /^[6-9]\d{9}$/;
const COUNTRY_CODE_RE = /^\d{1,4}$/;

const optionalTrimmed = (max: number, validate?: (v: string) => boolean, msg?: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.trim() : v))
    .transform((v) => (v === '' ? null : v))
    .superRefine((v, ctx) => {
      if (typeof v !== 'string') return;
      if (v.length > max) {
        ctx.addIssue({ code: 'custom', message: `Must be at most ${max} characters` });
        return;
      }
      if (validate && !validate(v)) {
        ctx.addIssue({ code: 'custom', message: msg ?? 'Invalid value' });
      }
    });

export const CreateAdminUserSchema = z
  .object({
    username: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, underscore, or dash'),
    email: z.email().max(255),
    password: z.string().min(8).max(128),
    first_name: optionalTrimmed(64),
    last_name: optionalTrimmed(64),
    country_code: optionalTrimmed(
      8,
      (v) => COUNTRY_CODE_RE.test(v),
      "Country code must be digits only (e.g. '91')",
    ),
    mobile_number: optionalTrimmed(
      16,
      (v) => INDIA_LOCAL_RE.test(v),
      'Indian mobile must be 10 digits starting with 6-9',
    ),
  })
  .strict();

export class CreateAdminUserDto extends createZodDto(CreateAdminUserSchema) {}
