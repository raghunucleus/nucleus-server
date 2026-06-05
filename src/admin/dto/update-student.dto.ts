import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BLOOD_GROUPS, ENTRY_TYPES, GENDERS } from '../entities/student.entity';

// Entry type — 1 (Regular) or 2 (Lateral). Omit to leave untouched.
const entryTypeSchema = z.coerce
  .number()
  .int()
  .refine(
    (v): v is (typeof ENTRY_TYPES)[number] =>
      (ENTRY_TYPES as readonly number[]).includes(v),
    'Entry type must be 1 (Regular) or 2 (Lateral)',
  )
  .optional();

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

// undefined → leave field untouched; otherwise validate. dob is NOT NULL in
// the DB, so clearing it via PATCH is no longer allowed.
const dobSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional();

const bloodGroupSchema = z
  .union([z.enum(BLOOD_GROUPS), z.literal(''), z.null()])
  .optional()
  .transform((v): string | null | undefined =>
    v === undefined ? undefined : v === '' ? null : v,
  );

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
  .transform((v): string | null | undefined =>
    v === undefined ? undefined : v === '' ? null : v,
  );

export const UpdateStudentSchema = z
  .object({
    student_id: studentIdSchema.optional(),
    programme_id: z.coerce.number().int().positive().optional(),
    admission_year_id: z.coerce.number().int().positive().optional(),
    display_name: z.string().trim().min(1).max(128).optional(),
    gender: z.enum(GENDERS).optional(),
    entry_type: entryTypeSchema,
    dob: dobSchema,
    blood_group: bloodGroupSchema,
    abc_id: abcIdSchema,
    mobile_number: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number')
      .optional(),
    email: z
      .string()
      .trim()
      .max(255)
      .email()
      .transform((v) => v.toLowerCase())
      .optional(),
  })
  .strict();

export class UpdateStudentDto extends createZodDto(UpdateStudentSchema) {}
