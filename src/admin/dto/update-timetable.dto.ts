import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Metadata-only patch — name and working_days. Periods are edited via
// PUT .../periods. The timetable's date range comes from the parent
// programme_semester's planned_start_date / planned_end_date now, so
// there's nothing date-related on the timetable itself to patch.
export const UpdateTimetableSchema = z
  .object({
    name: z.string().trim().min(1).max(96).optional(),
    working_days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((d) => new Set(d).size === d.length, {
        message: 'working_days must not contain duplicate days',
      })
      .optional(),
  })
  .strict();

export class UpdateTimetableDto extends createZodDto(UpdateTimetableSchema) {}
