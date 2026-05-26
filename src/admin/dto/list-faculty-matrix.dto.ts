import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Faculty matrix is scoped to a (programme, admission year) batch so the
// groups for that batch can be loaded alongside the semester's subjects.
// The programme-semester id alone isn't enough — programme_semesters carries
// the programme id but not the admission year cohort that owns the groups.
export const ListFacultyMatrixSchema = z
  .object({
    programmeSemesterId: z.coerce.number().int().positive(),
    programmeId: z.coerce.number().int().positive(),
    admissionYearId: z.coerce.number().int().positive(),
  })
  .strict();

export class ListFacultyMatrixDto extends createZodDto(
  ListFacultyMatrixSchema,
) {}
