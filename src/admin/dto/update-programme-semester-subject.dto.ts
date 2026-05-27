import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PROGRAMME_SEMESTER_SUBJECT_SLOT_TYPES } from '../entities/programme-semester-subject.entity';

// programme_semester_id is fixed at creation (a row is "owned" by that
// semester). To re-target, delete and recreate.
//
// You may swap the row from real-subject to elective-slot or vice versa by
// patching one and clearing the other. The service validates that exactly
// one of (subject_id, placeholder_name) ends up set after the patch is
// applied.
export const UpdateProgrammeSemesterSubjectSchema = z
  .object({
    subject_id: z
      .union([z.coerce.number().int().positive(), z.null()])
      .optional(),
    placeholder_name: z
      .union([z.string().trim().max(64), z.null()])
      .optional()
      .transform((v) =>
        typeof v === 'string' && v === '' ? null : v,
      ),
    credits: z.coerce.number().multipleOf(0.5).min(0).max(30).optional(),
    // null clears slot_type (only valid when swapping to a real subject in
    // the same patch). For slot-to-slot category changes, pass the new value.
    slot_type: z
      .union([z.enum(PROGRAMME_SEMESTER_SUBJECT_SLOT_TYPES), z.null()])
      .optional(),
    // Same as create — meaningful for slot rows only.
    cohort_scope: z.enum(['group', 'programme_semester']).optional(),
    // When provided, REPLACES the existing candidate pool wholesale. Only
    // meaningful for slot rows; rejected for real subjects in the service.
    option_subject_ids: z
      .array(z.coerce.number().int().positive())
      .max(50)
      .optional(),
  })
  .strict();

export class UpdateProgrammeSemesterSubjectDto extends createZodDto(
  UpdateProgrammeSemesterSubjectSchema,
) {}
