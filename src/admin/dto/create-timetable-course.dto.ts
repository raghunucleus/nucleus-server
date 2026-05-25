import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Adds a subject exclusive to one timetable. Exactly one of subject_id
// (master catalog) or custom_label (free-text activity) must be set. The
// timetable id comes from the route. employee_ids is the optional starting
// faculty roster.
export const CreateTimetableCourseSchema = z
  .object({
    subject_id: z.coerce.number().int().positive().optional(),
    custom_label: z.string().trim().min(1).max(96).optional(),
    employee_ids: z
      .array(z.coerce.number().int().positive())
      .max(20)
      .optional()
      .transform((v) => (v ? Array.from(new Set(v)) : [])),
  })
  .strict()
  .refine(
    (v) => (v.subject_id !== undefined) !== (v.custom_label !== undefined),
    {
      message:
        'Provide exactly one of subject_id (master subject) or custom_label (free-text)',
    },
  );

export class CreateTimetableCourseDto extends createZodDto(
  CreateTimetableCourseSchema,
) {}
