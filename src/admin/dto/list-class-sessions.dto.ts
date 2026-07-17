import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

export const ListClassSessionsSchema = z
  .object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    programme_semester_id: z.coerce.number().int().positive().optional(),
    attendance_group_id: z.coerce.number().int().positive().optional(),
    effective_employee_id: z.coerce.number().int().positive().optional(),
    status: z
      .union([
        z.enum(['scheduled', 'completed', 'cancelled', 'rescheduled']),
        z.array(z.enum(['scheduled', 'completed', 'cancelled', 'rescheduled'])),
      ])
      .optional(),
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    message: 'to must not be before from',
    path: ['to'],
  });

export class ListClassSessionsDto extends createZodDto(
  ListClassSessionsSchema,
) {}
