import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// One of `subject_id` (real subject) or `placeholder_name` (open-elective
// slot) must be set, never both. `option_subject_ids` is the candidate
// pool for an elective slot and is required when the row is an elective.
export const CreateProgrammeSemesterSubjectSchema = z
  .object({
    programme_semester_id: z.coerce.number().int().positive(),
    subject_id: z.coerce.number().int().positive().optional(),
    placeholder_name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .transform((v) => (v === '' || v === undefined ? undefined : v)),
    option_subject_ids: z
      .array(z.coerce.number().int().positive())
      .max(50)
      .optional(),
    // Credits as a number on the wire; serialised back as numeric in PG. One
    // decimal place; range 0.5 to 30 covers all practical credit values.
    credits: z.coerce.number().multipleOf(0.5).min(0.5).max(30),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasSubject = val.subject_id !== undefined;
    const hasPlaceholder =
      val.placeholder_name !== undefined && val.placeholder_name !== '';
    if (hasSubject === hasPlaceholder) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Provide exactly one of subject_id (real subject) or placeholder_name (elective slot)',
        path: ['subject_id'],
      });
      return;
    }
    // Real subject rows never carry an option pool.
    if (hasSubject && val.option_subject_ids && val.option_subject_ids.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'option_subject_ids is only valid for open-elective slots',
        path: ['option_subject_ids'],
      });
    }
    // Elective slots must list at least one candidate subject.
    if (hasPlaceholder) {
      const options = val.option_subject_ids ?? [];
      if (options.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Pick at least one candidate subject for the elective slot',
          path: ['option_subject_ids'],
        });
      }
      const unique = new Set(options);
      if (unique.size !== options.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Candidate subjects must be unique',
          path: ['option_subject_ids'],
        });
      }
    }
  });

export class CreateProgrammeSemesterSubjectDto extends createZodDto(
  CreateProgrammeSemesterSubjectSchema,
) {}
