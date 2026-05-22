import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Replace-semantics: the provided list becomes the complete faculty roster
// for the subject entry. An empty array clears all allocated faculty.
export const SetProgrammeSemesterSubjectFacultySchema = z
  .object({
    employee_ids: z
      .array(z.coerce.number().int().positive())
      .max(50)
      .superRefine((ids, ctx) => {
        if (new Set(ids).size !== ids.length) {
          ctx.addIssue({ code: 'custom', message: 'Faculty must be unique' });
        }
      }),
  })
  .strict();

export class SetProgrammeSemesterSubjectFacultyDto extends createZodDto(
  SetProgrammeSemesterSubjectFacultySchema,
) {}
