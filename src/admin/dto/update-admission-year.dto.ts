import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateAdmissionYearSchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    display_year: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export class UpdateAdmissionYearDto extends createZodDto(UpdateAdmissionYearSchema) {}
