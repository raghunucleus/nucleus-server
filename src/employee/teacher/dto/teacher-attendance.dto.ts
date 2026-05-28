import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TeacherDayQuerySchema = z
  .object({ date: z.string().regex(DATE_RE, 'Use YYYY-MM-DD') })
  .strict();
export class TeacherDayQueryDto extends createZodDto(TeacherDayQuerySchema) {}

export const TeacherHistoryQuerySchema = z
  .object({
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    message: 'to must not be before from',
    path: ['to'],
  });
export class TeacherHistoryQueryDto extends createZodDto(
  TeacherHistoryQuerySchema,
) {}

export const TeacherMarkAttendanceSchema = z
  .object({
    allow_amend: z.boolean().optional(),
    entries: z
      .array(
        z
          .object({
            student_id: z.coerce.number().int().positive(),
            status: z.enum(['present', 'absent', 'late', 'exempt', 'od']),
          })
          .strict(),
      )
      .min(1)
      .max(5000),
  })
  .strict();
export class TeacherMarkAttendanceDto extends createZodDto(
  TeacherMarkAttendanceSchema,
) {}
