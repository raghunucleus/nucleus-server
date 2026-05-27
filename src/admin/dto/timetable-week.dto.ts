import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

export const WeekWindowSchema = z
  .object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
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
