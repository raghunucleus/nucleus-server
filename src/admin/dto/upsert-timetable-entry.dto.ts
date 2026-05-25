import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Places (or replaces) the class in one grid cell. Exactly one of
// programme_semester_subject_id (a semester-linked subject) or
// timetable_course_id (a timetable-exclusive course) identifies what is
// taught. employee_id is the chosen teacher — omit/null leaves it unassigned.
export const UpsertTimetableEntrySchema = z
  .object({
    day_of_week: z.coerce.number().int().min(1).max(7),
    timetable_period_id: z.coerce.number().int().positive(),
    // How many consecutive periods the class occupies (merged-period labs).
    span: z.coerce.number().int().min(1).max(20).default(1),
    programme_semester_subject_id: z.coerce.number().int().positive().optional(),
    timetable_course_id: z.coerce.number().int().positive().optional(),
    employee_id: z
      .coerce.number()
      .int()
      .positive()
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    // nullish — the client sends null (not just omits) when the field is
    // cleared; both null and undefined normalise to null.
    room: z
      .string()
      .trim()
      .max(48)
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : null)),
    note: z
      .string()
      .trim()
      .max(160)
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .strict()
  .refine(
    (v) =>
      (v.programme_semester_subject_id !== undefined) !==
      (v.timetable_course_id !== undefined),
    {
      message:
        'Provide exactly one of programme_semester_subject_id or timetable_course_id',
    },
  );

export class UpsertTimetableEntryDto extends createZodDto(
  UpsertTimetableEntrySchema,
) {}
