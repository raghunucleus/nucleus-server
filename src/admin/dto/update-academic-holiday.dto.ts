import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

// Editing a declared holiday. Same shape as create. Scheduled sessions newly
// caught by the edited range are always cancelled in the same transaction;
// sessions cancelled by a previous version of this holiday are never
// un-cancelled by an edit (mirrors the delete contract).
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
