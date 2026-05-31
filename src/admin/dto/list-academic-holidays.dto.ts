import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from './create-timetable.dto';

export const ListAcademicHolidaysSchema = z
  .object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD').optional(),
  })
  .strict();

export class ListAcademicHolidaysDto extends createZodDto(
  ListAcademicHolidaysSchema,
) {}
