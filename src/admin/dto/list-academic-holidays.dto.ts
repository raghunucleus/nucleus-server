import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

export const ListAcademicHolidaysSchema = z
  .object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    scope: z.enum(['institution', 'programme', 'group']).optional(),
    programme_id: z.coerce.number().int().positive().optional(),
    attendance_group_id: z.coerce.number().int().positive().optional(),
  })
  .strict();

export class ListAcademicHolidaysDto extends createZodDto(
  ListAcademicHolidaysSchema,
) {}
