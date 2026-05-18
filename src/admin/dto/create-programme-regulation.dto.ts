import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateProgrammeRegulationSchema = z
  .object({
    programme_id: z.coerce.number().int().positive(),
    admission_year_id: z.coerce.number().int().positive(),
    regulation_id: z.coerce.number().int().positive(),
  })
  .strict();

export class CreateProgrammeRegulationDto extends createZodDto(
  CreateProgrammeRegulationSchema,
) {}
