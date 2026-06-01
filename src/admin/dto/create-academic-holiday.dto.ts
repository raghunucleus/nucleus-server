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
    type: z.enum(['public', 'institutional', 'unplanned']),
    reason: z.string().trim().max(256).nullish(),
  })
  .strict()
  .refine(
    (v) => v.end_date === null || v.end_date === undefined || v.end_date >= v.date,
    { message: 'end_date must not be before date', path: ['end_date'] },
  );

export class CreateAcademicHolidayDto extends createZodDto(
  CreateAcademicHolidaySchema,
) {}
