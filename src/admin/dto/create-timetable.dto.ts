import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// True when no two periods overlap in time. Gaps between periods are allowed;
// overlaps are not. Times are 'HH:MM', so plain string comparison is
// chronological.
export function periodsDoNotOverlap(
  periods: { start_time: string; end_time: string }[],
): boolean {
  const sorted = [...periods].sort((a, b) =>
    a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0,
  );
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start_time < sorted[i - 1].end_time) return false;
  }
  return true;
}

// A new period row for a brand-new timetable — no id (every row is created).
export const NewTimetablePeriodSchema = z
  .object({
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

export const CreateTimetableSchema = z
  .object({
    programme_semester_id: z.coerce.number().int().positive(),
    attendance_group_id: z.coerce.number().int().positive(),
    name: z.string().trim().min(1).max(96),
    effective_from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    // Optional — empty/missing/null is normalised to null (open-ended).
    effective_to: z
      .string()
      .regex(DATE_RE, 'Use YYYY-MM-DD')
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : null)),
    // ISO weekday numbers (1 = Mon … 7 = Sun).
    working_days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((d) => new Set(d).size === d.length, {
        message: 'working_days must not contain duplicate days',
      }),
    periods: z
      .array(NewTimetablePeriodSchema)
      .min(1)
      .max(20)
      .refine(periodsDoNotOverlap, {
        message: 'Period times must not overlap each other',
      }),
  })
  .strict()
  .refine(
    (v) => v.effective_to === null || v.effective_to >= v.effective_from,
    {
      message: 'effective_to must not be before effective_from',
      path: ['effective_to'],
    },
  );

export class CreateTimetableDto extends createZodDto(CreateTimetableSchema) {}
