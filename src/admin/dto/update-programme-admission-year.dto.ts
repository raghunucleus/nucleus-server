import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Only the regulation is editable — the (programme, admission year) tuple
// identifies the row and must stay fixed. To re-target the row to a
// different batch, delete and recreate.
export const UpdateProgrammeAdmissionYearSchema = z
  .object({
    regulation_id: z.coerce.number().int().positive(),
  })
  .strict();

export class UpdateProgrammeAdmissionYearDto extends createZodDto(
  UpdateProgrammeAdmissionYearSchema,
) {}
