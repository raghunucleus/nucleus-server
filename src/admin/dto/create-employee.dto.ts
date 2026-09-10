import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_DEVICE_LIMIT } from '../../auth-sessions/session.constants';
import { GENDERS } from '../entities/employee.entity';

const empCodeSchema = z
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
  );

const dobSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    z.literal(''),
    z.null(),
  ])
  .optional()
  .transform((v): string | null => (v === undefined || v === '' ? null : v));

export const CreateEmployeeSchema = z
  .object({
    emp_code: empCodeSchema,
    emp_display_name: z.string().trim().min(1).max(128),
    gender: z.enum(GENDERS),
    dob: dobSchema,
    department_id: z.coerce.number().int().positive(),
    designation_id: z.coerce.number().int().positive(),
    mobile_number: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[0-9]+$/, 'Digits only'),
    country_code: z
      .string()
      .trim()
      .max(8)
      .regex(/^[0-9]+$/, 'Digits only')
      .default('91'),
    email: z
      .string()
      .trim()
      .max(255)
      .email()
      .transform((v) => v.toLowerCase()),
    rm_emp_code: z
      .union([empCodeSchema, z.null()])
      .optional()
      .transform((v) => (v === undefined ? null : v)),
    // Concurrent-device override; null/absent = the global default (2).
    device_limit: z
      .union([z.number().int().min(1).max(MAX_DEVICE_LIMIT), z.null()])
      .optional()
      .transform((v) => (v === undefined ? null : v)),
  })
  .strict();

export class CreateEmployeeDto extends createZodDto(CreateEmployeeSchema) {}
