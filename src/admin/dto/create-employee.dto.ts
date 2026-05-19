import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
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
      .regex(/^[A-Z0-9._-]+$/, 'Use letters, numbers, dot, underscore, or dash'),
  );

export const CreateEmployeeSchema = z
  .object({
    emp_code: empCodeSchema,
    emp_display_name: z.string().trim().min(1).max(128),
    gender: z.enum(GENDERS),
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
  })
  .strict();

export class CreateEmployeeDto extends createZodDto(CreateEmployeeSchema) {}
