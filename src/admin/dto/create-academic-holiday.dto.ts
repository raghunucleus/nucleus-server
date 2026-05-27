import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

export const CreateAcademicHolidaySchema = z
  .object({
    date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    end_date: z
      .string()
      .regex(DATE_RE, 'Use YYYY-MM-DD')
      .nullish()
      .transform((v) => (v && v.length > 0 ? v : null)),
    name: z.string().trim().min(1).max(120),
    scope: z.enum(['institution', 'programme', 'group']),
    programme_id: z.coerce.number().int().positive().nullish(),
    attendance_group_id: z.coerce.number().int().positive().nullish(),
    type: z.enum(['public', 'institutional', 'unplanned', 'half_day']),
    reason: z.string().trim().max(256).nullish(),
    // When true, cancel any already-seeded scheduled sessions on matching
    // dates / scope. Defaults true since the endpoint is the canonical way
    // to declare a holiday mid-semester. Set false for pre-semester adds.
    cancel_existing_sessions: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) => v.scope !== 'programme' || (v.programme_id ?? null) !== null,
    {
      message: 'programme_id is required when scope is "programme"',
      path: ['programme_id'],
    },
  )
  .refine(
    (v) => v.scope !== 'group' || (v.attendance_group_id ?? null) !== null,
    {
      message: 'attendance_group_id is required when scope is "group"',
      path: ['attendance_group_id'],
    },
  )
  .refine(
    (v) => v.scope !== 'institution' || (!v.programme_id && !v.attendance_group_id),
    {
      message: 'Institution-scoped holidays must not name a programme or group',
      path: ['scope'],
    },
  )
  .refine(
    (v) => v.end_date === null || v.end_date === undefined || v.end_date >= v.date,
    { message: 'end_date must not be before date', path: ['end_date'] },
  );

export class CreateAcademicHolidayDto extends createZodDto(
  CreateAcademicHolidaySchema,
) {}
