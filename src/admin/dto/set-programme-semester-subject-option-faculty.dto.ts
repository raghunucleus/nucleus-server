import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Replace-semantics: the provided list becomes the complete faculty roster
// for one elective candidate subject. An empty array clears all allocated
// faculty. Will fold into the student-allocation flow in a future change.
export const SetProgrammeSemesterSubjectOptionFacultySchema = z
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

export class SetProgrammeSemesterSubjectOptionFacultyDto extends createZodDto(
  SetProgrammeSemesterSubjectOptionFacultySchema,
) {}
