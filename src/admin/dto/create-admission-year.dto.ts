import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateAdmissionYearSchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    display_year: z.string().trim().min(1).max(32),
  })
  .strict();

export class CreateAdmissionYearDto extends createZodDto(CreateAdmissionYearSchema) {}
