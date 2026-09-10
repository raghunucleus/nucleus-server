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

// null/'' clears the date of birth; undefined leaves it untouched.
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
  .transform((v): string | null | undefined => (v === '' ? null : v));

export const UpdateEmployeeSchema = z
  .object({
    emp_code: empCodeSchema.optional(),
    emp_display_name: z.string().trim().min(1).max(128).optional(),
    gender: z.enum(GENDERS).optional(),
    dob: dobSchema,
    department_id: z.coerce.number().int().positive().optional(),
    designation_id: z.coerce.number().int().positive().optional(),
    mobile_number: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[0-9]+$/, 'Digits only')
      .optional(),
    country_code: z
      .string()
      .trim()
      .max(8)
      .regex(/^[0-9]+$/, 'Digits only')
      .optional(),
    email: z
      .string()
      .trim()
      .max(255)
      .email()
      .transform((v) => v.toLowerCase())
      .optional(),
    // null clears the reporting manager; undefined leaves it untouched.
    rm_emp_code: z.union([empCodeSchema, z.null()]).optional(),
    // Concurrent-device override. null resets to the global default (2);
    // undefined leaves it untouched. Lowering it never evicts anyone.
    device_limit: z
      .union([z.number().int().min(1).max(MAX_DEVICE_LIMIT), z.null()])
      .optional(),
  })
  .strict();

export class UpdateEmployeeDto extends createZodDto(UpdateEmployeeSchema) {}
