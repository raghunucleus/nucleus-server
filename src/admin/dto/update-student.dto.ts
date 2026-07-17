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
  .pipe(z.string().regex(/^[A-Z0-9]+$/, 'Use letters and numbers only'));

// undefined → leave field untouched; otherwise validate. dob is NOT NULL in
// the DB, so clearing it via PATCH is no longer allowed.
const dobSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional();

/**
 * undefined → leave untouched; '' or null → clear to NULL; otherwise validate
 * with `schema`. Every nullable profile column uses this so admins can empty a
 * field (students never can — clearing stays an admin operation).
 */
const clearable = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([schema, z.literal(''), z.null()])
    .optional()
    .transform((v): z.output<T> | null | undefined =>
      v === undefined ? undefined : v === '' || v === null ? null : v,
    );

const bloodGroupSchema = clearable(z.enum(BLOOD_GROUPS));

const abcIdSchema = clearable(
  z
    .string()
    .trim()
    .regex(/^\d{12}$/, 'ABC ID must be exactly 12 digits'),
);

const CURRENT_YEAR = new Date().getFullYear();

const name64 = z.string().trim().min(1).max(64);
const name128 = z.string().trim().min(1).max(128);
const text255 = z.string().trim().min(1).max(255);
const emailSchema = z
  .string()
  .trim()
  .max(255)
  .email()
  .transform((v) => v.toLowerCase());
const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const percentageSchema = z.coerce.number().min(0).max(100);
const yearSchema = z.coerce
  .number()
  .int()
  .min(1950)
  .max(CURRENT_YEAR + 1);
const fkIdSchema = z.coerce.number().int().positive();
const nullableBoolean = z.union([z.boolean(), z.null()]).optional();

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
    mobile_number: mobileSchema.optional(),
    email: emailSchema.optional(),

    // --- Extended profile (admins edit ANY field directly — the per-field
    // student policies in profile-fields.ts do not apply here) ---------------
    first_name: clearable(name64),
    middle_name: clearable(name64),
    last_name: clearable(name64),
    personal_email: clearable(emailSchema),
    pass_out_year: clearable(z.coerce.number().int().min(1950).max(2100)),
    tenth_percentage: clearable(percentageSchema),
    twelfth_percentage: clearable(percentageSchema),
    diploma_percentage: clearable(percentageSchema),
    ug_cgpa: clearable(z.coerce.number().min(0).max(10)),
    current_backlogs: clearable(z.coerce.number().int().min(0).max(60)),
    backlog_history: z.boolean().optional(),
    parent_name: clearable(name128),
    parent_mobile: clearable(mobileSchema),
    parent_email: clearable(emailSchema),
    guardian_name: clearable(name128),
    guardian_mobile: clearable(mobileSchema),
    guardian_email: clearable(emailSchema),
    home_address: clearable(z.string().trim().min(1).max(1000)),
    home_district_id: clearable(fkIdSchema),
    home_pincode: clearable(
      z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'Pincode must be exactly 6 digits'),
    ),
    home_state_id: clearable(fkIdSchema),
    home_country_id: clearable(fkIdSchema),
    aadhaar_number: clearable(
      z
        .string()
        .trim()
        .regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits'),
    ),
    pan_number: clearable(
      z
        .string()
        .trim()
        .transform((v) => v.toUpperCase())
        .pipe(
          z
            .string()
            .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Enter a valid PAN (AAAAA9999A)'),
        ),
    ),
    entrance_exam_na: z.boolean().optional(),
    entrance_exam_id: clearable(fkIdSchema),
    entrance_exam_rank: clearable(z.coerce.number().int().positive()),
    entrance_exam_year: clearable(
      z.coerce.number().int().min(1950).max(CURRENT_YEAR),
    ),
    year_of_gap: clearable(z.coerce.number().int().min(0).max(10)),
    reason_of_gap: clearable(z.string().trim().min(1).max(1000)),
    tenth_board_id: clearable(fkIdSchema),
    tenth_institution: clearable(text255),
    tenth_year_of_pass: clearable(yearSchema),
    tenth_state_id: clearable(fkIdSchema),
    twelfth_board_id: clearable(fkIdSchema),
    twelfth_institution: clearable(text255),
    twelfth_year_of_pass: clearable(yearSchema),
    twelfth_state_id: clearable(fkIdSchema),
    diploma_board_id: clearable(fkIdSchema),
    diploma_institution: clearable(text255),
    diploma_year_of_pass: clearable(yearSchema),
    diploma_specialization: clearable(name128),
    diploma_state_id: clearable(fkIdSchema),
    allowed_by_dept_for_placements: nullableBoolean,
    interested_in_placements_self: nullableBoolean,
  })
  .strict()
  .superRefine((v, ctx) => {
    // The entrance na-invariant holds even for admins — na=true with a rank/
    // exam/year in the SAME patch is contradictory input (the service clears
    // the trio when only na=true is sent).
    if (
      v.entrance_exam_na === true &&
      (v.entrance_exam_id != null ||
        v.entrance_exam_rank != null ||
        v.entrance_exam_year != null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entrance_exam_na'],
        message:
          'When the entrance rank is marked not applicable, exam, rank and year must be empty.',
      });
    }
  });

export class UpdateStudentDto extends createZodDto(UpdateStudentSchema) {}
