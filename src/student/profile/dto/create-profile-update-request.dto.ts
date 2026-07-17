import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PROFILE_FIELD_DEFS } from '../profile-fields';

// The student-requestable profile fields, derived from the field-policy
// registry: only APPROVAL / AUTO_REQUESTABLE fields ever appear here — AUTO,
// SYSTEM_LOCKED, EXISTING_READONLY (college email), ADMIN_ONLY, OTP_VERIFY
// (personal email) and NO_APPROVAL (resume) fields are structurally excluded,
// so a crafted request naming them fails the `.strict()` schema with a 400.
// All optional, but at least one change must be present; clearing a value is
// deliberately not supported — that stays an admin operation.
//
// Per-entry-type visibility (12th block = Regular, Diploma block = Lateral) is
// enforced in the service, which knows the acting student.
const simpleShape: Record<string, z.ZodTypeAny> = {};
for (const def of PROFILE_FIELD_DEFS) {
  if (
    (def.policy === 'APPROVAL' || def.policy === 'AUTO_REQUESTABLE') &&
    !def.unit &&
    def.key !== 'industry_certifications' &&
    def.schema
  ) {
    simpleShape[def.key] = def.schema.optional();
  }
}

const CURRENT_YEAR = new Date().getFullYear();

// The entrance-exam fields travel as ONE atomic unit — a single change item,
// a single approver verdict. "Not applicable" is the explicit `na` flag;
// rank/exam/year are required exactly when a rank applies.
const EntranceExamGroupSchema = z
  .object({
    na: z.boolean(),
    entrance_exam_id: z.coerce.number().int().positive().nullish(),
    entrance_exam_rank: z.coerce.number().int().positive().nullish(),
    entrance_exam_year: z.coerce
      .number()
      .int()
      .min(1950)
      .max(CURRENT_YEAR)
      .nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.na) {
      if (
        v.entrance_exam_id != null ||
        v.entrance_exam_rank != null ||
        v.entrance_exam_year != null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'When the rank is not applicable, leave exam, rank and year empty.',
        });
      }
      return;
    }
    if (v.entrance_exam_rank == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entrance_exam_rank'],
        message: 'Enter the rank (or mark it not applicable).',
      });
    }
    if (v.entrance_exam_id == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entrance_exam_id'],
        message: 'Select the entrance exam.',
      });
    }
    if (v.entrance_exam_year == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['entrance_exam_year'],
        message: 'Enter the exam year.',
      });
    }
  });

// Gap pair — also one atomic unit. Reason is required exactly when a gap
// exists; a zero-year gap clears the reason server-side.
const GapGroupSchema = z
  .object({
    year_of_gap: z.coerce.number().int().min(0).max(10),
    reason_of_gap: z.string().trim().min(1).max(1000).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.year_of_gap > 0 && !v.reason_of_gap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason_of_gap'],
        message: 'Explain the reason for the gap.',
      });
    }
  });

// A certification entry is only submittable WITH its supporting file — the
// key comes from POST /student/profile/certifications/files; ownership and
// existence of the object are verified in the service.
const CertificationAddSchema = z
  .object({
    industry_certification_id: z.coerce.number().int().positive(),
    certificate_file_key: z.string().trim().min(1).max(512),
  })
  .strict();

const ProfileUpdateChangesSchema = z
  .object({
    ...simpleShape,
    entrance_exam: EntranceExamGroupSchema.optional(),
    gap: GapGroupSchema.optional(),
    certifications_add: z
      .array(CertificationAddSchema)
      .min(1)
      .max(10)
      .optional(),
  })
  .strict()
  .refine(
    (changes) => Object.values(changes).some((v) => v !== undefined),
    'Provide at least one field to change',
  );

export const CreateProfileUpdateRequestSchema = z
  .object({
    changes: ProfileUpdateChangesSchema,
    note: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .strict();

export class CreateProfileUpdateRequestDto extends createZodDto(
  CreateProfileUpdateRequestSchema,
) {}

export type ProfileUpdateChangesInput = z.infer<
  typeof ProfileUpdateChangesSchema
>;
