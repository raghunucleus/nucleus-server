import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PROGRAMME_SEMESTER_SUBJECT_SLOT_TYPES } from '../entities/programme-semester-subject.entity';

// One of `subject_id` (real subject) or `placeholder_name` (slot row) must
// be set, never both. For slot rows, `slot_type` chooses the category
// (open_elective / honors / minors) and `option_subject_ids` lists the
// candidate pool — both required when the row is a slot.
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
    slot_type: z.enum(PROGRAMME_SEMESTER_SUBJECT_SLOT_TYPES).optional(),
    // Slot-row cohort scope: 'group' keeps each attendance group's cohort
    // separate; 'programme_semester' merges identical (option, teacher)
    // cohorts across groups. Ignored for real subjects (always group-scoped).
    cohort_scope: z.enum(['group', 'programme_semester']).default('group'),
    option_subject_ids: z
      .array(z.coerce.number().int().positive())
      .max(50)
      .optional(),
    // Credits as a number on the wire; serialised back as numeric in PG. One
    // decimal place; 0 is allowed for non-credit subjects (audit / seminar /
    // mandatory non-graded entries); upper bound 30 covers all practical values.
    credits: z.coerce.number().multipleOf(0.5).min(0).max(30),
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
          'Provide exactly one of subject_id (real subject) or placeholder_name (slot)',
        path: ['subject_id'],
      });
      return;
    }
    // Real subject rows never carry a slot_type or option pool.
    if (hasSubject && val.slot_type !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'slot_type is only valid for slot rows',
        path: ['slot_type'],
      });
    }
    if (hasSubject && val.option_subject_ids && val.option_subject_ids.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'option_subject_ids is only valid for slot rows',
        path: ['option_subject_ids'],
      });
    }
    // Slot rows must specify which kind of slot they are + at least one
    // candidate subject.
    if (hasPlaceholder) {
      if (val.slot_type === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'slot_type is required for slot rows',
          path: ['slot_type'],
        });
      }
      const options = val.option_subject_ids ?? [];
      if (options.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Pick at least one candidate subject for the slot',
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
