import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

// Editing a declared holiday. Same shape as create, but `cancel_existing_sessions`
// defaults to FALSE here: an edit that merely fixes a typo or shifts the badge
// type must not silently re-cancel classes. Turn it on explicitly when an edit
// extends the date range and the newly-covered scheduled sessions should be
// cancelled too. Sessions cancelled by a previous version of this holiday are
// never un-cancelled by an edit (mirrors the delete contract).
export const UpdateAcademicHolidaySchema = z
  .object({
    date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    end_date: z
      .string()
      .regex(DATE_RE, 'Use YYYY-MM-DD')
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : null)),
    name: z.string().trim().min(1).max(120),
    type: z.enum(['public', 'institutional', 'unplanned']),
    reason: z.string().trim().max(256).nullish(),
    cancel_existing_sessions: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) =>
      v.end_date === null || v.end_date === undefined || v.end_date >= v.date,
    { message: 'end_date must not be before date', path: ['end_date'] },
  );

export class UpdateAcademicHolidayDto extends createZodDto(
  UpdateAcademicHolidaySchema,
) {}
