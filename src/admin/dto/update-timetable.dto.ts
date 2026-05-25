import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

// Metadata-only patch. Status moves through dedicated publish/archive
// endpoints; periods through PUT .../periods. effective_to vs effective_from
// is cross-checked in the service against the merged row.
export const UpdateTimetableSchema = z
  .object({
    name: z.string().trim().min(1).max(96).optional(),
    effective_from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    // undefined → leave as-is; '' or null → clear (open-ended).
    effective_to: z
      .union([z.string().regex(DATE_RE, 'Use YYYY-MM-DD'), z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === undefined ? undefined : v ? v : null)),
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
