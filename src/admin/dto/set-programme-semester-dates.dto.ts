import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

// Both nullable so the admin can clear one side without erasing both — the
// service enforces "end >= start when both are set" before persisting.
export const SetProgrammeSemesterDatesSchema = z
  .object({
    planned_start_date: z
      .string()
      .regex(DATE_RE, 'Use YYYY-MM-DD')
      .or(z.null())
      .or(z.literal(''))
      .transform((v) => (v === '' || v === null ? null : v)),
    planned_end_date: z
      .string()
      .regex(DATE_RE, 'Use YYYY-MM-DD')
      .or(z.null())
      .or(z.literal(''))
      .transform((v) => (v === '' || v === null ? null : v)),
  })
  .strict()
  .refine(
    (v) =>
      v.planned_end_date === null ||
      v.planned_start_date === null ||
      v.planned_end_date >= v.planned_start_date,
    {
      message: 'planned_end_date must not be before planned_start_date',
      path: ['planned_end_date'],
    },
  );

export class SetProgrammeSemesterDatesDto extends createZodDto(
  SetProgrammeSemesterDatesSchema,
) {}
