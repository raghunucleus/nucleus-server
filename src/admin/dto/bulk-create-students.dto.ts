import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BLOOD_GROUPS, GENDERS } from '../entities/student.entity';

const studentIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .transform((v) => v.toUpperCase())
  .pipe(
    z
      .string()
      .regex(/^[A-Z0-9]+$/, 'Use letters and numbers only'),
  );

const dobSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const bloodGroupSchema = z
  .union([z.enum(BLOOD_GROUPS), z.literal(''), z.null()])
  .optional()
  .transform((v): string | null => (v === undefined || v === '' ? null : v));

const abcIdSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^\d{12}$/, 'ABC ID must be exactly 12 digits'),
    z.literal(''),
    z.null(),
  ])
  .optional()
  .transform((v): string | null => (v === undefined || v === '' ? null : v));

export const BulkCreateStudentRowSchema = z
  .object({
    student_id: studentIdSchema,
    display_name: z.string().trim().min(1).max(128),
    gender: z.enum(GENDERS),
    dob: dobSchema,
    blood_group: bloodGroupSchema,
    abc_id: abcIdSchema,
    mobile_number: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
    email: z
      .string()
      .trim()
      .max(255)
      .email()
      .transform((v) => v.toLowerCase()),
  })
  .strict();

export const BulkCreateStudentsSchema = z
  .object({
    programme_id: z.coerce.number().int().positive(),
    admission_year_id: z.coerce.number().int().positive(),
    rows: z.array(BulkCreateStudentRowSchema).min(1).max(1000),
  })
  .strict();

export class BulkCreateStudentsDto extends createZodDto(
  BulkCreateStudentsSchema,
) {}
