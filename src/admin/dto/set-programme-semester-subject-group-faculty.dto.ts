import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// One teacher per (subject, group) cell. employee_id null clears the cell —
// the row is deleted instead of being kept around with a null teacher.
export const SetProgrammeSemesterSubjectGroupFacultySchema = z
  .object({
    employee_id: z
      .union([z.coerce.number().int().positive(), z.null()]),
  })
  .strict();

export class SetProgrammeSemesterSubjectGroupFacultyDto extends createZodDto(
  SetProgrammeSemesterSubjectGroupFacultySchema,
) {}
