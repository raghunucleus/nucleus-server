import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { optionalLgdCode } from './address-attribute-fields.dto';

// No country_id here: a district's country is implied by its state. The admin
// UI shows a country picker on this form, but only to narrow the state list —
// it is not part of the payload.
export const CreateDistrictSchema = z
  .object({
    state_id: z.coerce.number().int().positive(),
    name: z.string().trim().min(1).max(128),
    lgd_code: optionalLgdCode,
  })
  .strict();

export class CreateDistrictDto extends createZodDto(CreateDistrictSchema) {}
