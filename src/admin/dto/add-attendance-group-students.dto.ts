import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Students to place in the group. A student already in another group of the
// same programme-semester is moved into this one.
export const AddAttendanceGroupStudentsSchema = z
  .object({
    student_ids: z
      .array(z.coerce.number().int().positive())
      .min(1, 'Pick at least one student')
      .max(2000, 'Cannot assign more than 2000 students at once')
      .superRefine((ids, ctx) => {
        if (new Set(ids).size !== ids.length) {
          ctx.addIssue({ code: 'custom', message: 'Students must be unique' });
        }
      }),
  })
  .strict();

export class AddAttendanceGroupStudentsDto extends createZodDto(
  AddAttendanceGroupStudentsSchema,
) {}
