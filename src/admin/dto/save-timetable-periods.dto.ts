import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { periodsDoNotOverlap, TIME_RE } from './create-timetable.dto';

// One period row in a bulk save. Rows carrying an `id` are existing periods
// updated in place (their scheduled cells survive); rows without one are
// inserted. Existing periods absent from the payload are deleted, taking
// their cells with them. Array order sets each row's position.
export const SaveTimetablePeriodSchema = z
  .object({
    id: z.coerce.number().int().positive().optional(),
    label: z.string().trim().min(1).max(48),
    start_time: z.string().regex(TIME_RE, 'Use HH:MM'),
    end_time: z.string().regex(TIME_RE, 'Use HH:MM'),
    is_break: z.boolean().default(false),
  })
  .strict()
  .refine((p) => p.start_time < p.end_time, {
    message: 'Period end time must be after its start time',
    path: ['end_time'],
  });

export const SaveTimetablePeriodsSchema = z
  .object({
    periods: z
      .array(SaveTimetablePeriodSchema)
      .min(1)
      .max(20)
      .refine(periodsDoNotOverlap, {
        message: 'Period times must not overlap each other',
      }),
  })
  .strict();

export class SaveTimetablePeriodsDto extends createZodDto(
  SaveTimetablePeriodsSchema,
) {}
