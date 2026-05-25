import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

// Clones a timetable into a fresh draft — its periods, exclusive courses (and
// their faculty) and entries are copied. Used to plan a future revision, or
// to seed another section's timetable. attendance_group_id defaults to the
// source's group when omitted.
export const DuplicateTimetableSchema = z
  .object({
    name: z.string().trim().min(1).max(96),
    effective_from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    // nullish — an open-ended source timetable sends effective_to: null.
    effective_to: z
      .string()
      .regex(DATE_RE, 'Use YYYY-MM-DD')
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : null)),
    attendance_group_id: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (v) => v.effective_to === null || v.effective_to >= v.effective_from,
    {
      message: 'effective_to must not be before effective_from',
      path: ['effective_to'],
    },
  );

export class DuplicateTimetableDto extends createZodDto(
  DuplicateTimetableSchema,
) {}
