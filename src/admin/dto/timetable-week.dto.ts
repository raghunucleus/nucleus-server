import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

export const WeekWindowSchema = z
  .object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    // Optional ISO weekday filter (1=Mon..7=Sun). When omitted, every
    // working day inside [from, to] is considered (the original behavior).
    // When present, both the wipe and the seed are scoped to these
    // weekdays — used to publish a different template for a subset of
    // the week (e.g. Thu+Fri+Sat) without touching the rest.
    days_of_week: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((a) => new Set(a).size === a.length, {
        message: 'days_of_week must contain unique values',
      })
      .optional(),
    // Preview rows the caller chose NOT to publish (e.g. a class that would
    // clash with a kept marked one). Each entry identifies a seed row by its
    // slot key; the seeder skips matching rows during publish. Publish-only —
    // preview ignores it so the UI can still show + toggle the rows.
    exclude: z
      .array(
        z
          .object({
            session_date: z.string().regex(DATE_RE),
            timetable_period_id: z.number().int().positive(),
            programme_semester_subject_id: z.number().int().positive(),
            programme_semester_subject_option_id: z
              .number()
              .int()
              .positive()
              .nullable(),
          })
          .strict(),
      )
      .max(500)
      .optional(),
    // When true (the incharge publish dialog default), notify the group's
    // students that their timetable for this week changed. Publish-only.
    notify: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    message: 'to must not be before from',
    path: ['to'],
  });

export const WeekSummariesSchema = z
  .object({
    // Accepts an array of Monday-dates; the service buckets sessions into
    // the corresponding Mon..Sun windows.
    week_starts: z.array(z.string().regex(DATE_RE)).min(1).max(52),
  })
  .strict();

export class WeekWindowDto extends createZodDto(WeekWindowSchema) {}
export class WeekSummariesDto extends createZodDto(WeekSummariesSchema) {}
