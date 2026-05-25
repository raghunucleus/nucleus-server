import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Replaces an exclusive course's faculty roster wholesale — send the full
// list; an empty list clears it.
export const SetTimetableCourseFacultySchema = z
  .object({
    employee_ids: z
      .array(z.coerce.number().int().positive())
      .max(20)
      .transform((v) => Array.from(new Set(v))),
  })
  .strict();

export class SetTimetableCourseFacultyDto extends createZodDto(
  SetTimetableCourseFacultySchema,
) {}
