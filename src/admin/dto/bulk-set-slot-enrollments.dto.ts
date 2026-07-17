import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Body of POST /admin/programme-semester-subjects/:slotId/enrollments/bulk.
//
// Each row is one student's pick for the slot. Semantic = REPLACE: the
// student's existing assignment for the slot (if any) is dropped, then the
// new (candidate, faculty) pair is recorded — both are mandatory together.
// Pass option_subject_code = null (and faculty_emp_code = null) to CLEAR
// the student's pick instead.
//
// Students NOT mentioned in `rows` are left untouched.
export const BulkSetSlotEnrollmentRowSchema = z
  .object({
    student_id: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .transform((v) => v.toUpperCase()),
    option_subject_code: z
      .union([
        z
          .string()
          .trim()
          .min(1)
          .max(32)
          .transform((v) => v.toUpperCase()),
        z.literal(''),
        z.null(),
      ])
      .optional()
      .transform((v) => (v === undefined || v === '' || v === null ? null : v)),
    faculty_emp_code: z
      .union([
        z
          .string()
          .trim()
          .min(1)
          .max(32)
          .transform((v) => v.toUpperCase()),
        z.literal(''),
        z.null(),
      ])
      .optional()
      .transform((v) => (v === undefined || v === '' || v === null ? null : v)),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Candidate + faculty are coupled: either both set (assign) or both
    // null (clear). Half-set rows are ambiguous so we reject up-front.
    const hasOption = val.option_subject_code !== null;
    const hasFaculty = val.faculty_emp_code !== null;
    if (hasOption !== hasFaculty) {
      ctx.addIssue({
        code: 'custom',
        message:
          'option_subject_code and faculty_emp_code must both be set, or both omitted/null',
        path: hasOption ? ['faculty_emp_code'] : ['option_subject_code'],
      });
    }
  });

export const BulkSetSlotEnrollmentsSchema = z
  .object({
    rows: z.array(BulkSetSlotEnrollmentRowSchema).min(1).max(2000),
  })
  .strict();

export class BulkSetSlotEnrollmentsDto extends createZodDto(
  BulkSetSlotEnrollmentsSchema,
) {}
