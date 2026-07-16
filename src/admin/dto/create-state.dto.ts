import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  optionalLgdCode,
  optionalStateIsoCode,
} from './address-attribute-fields.dto';

export const CreateStateSchema = z
  .object({
    country_id: z.coerce.number().int().positive(),
    name: z.string().trim().min(1).max(128),
    lgd_code: optionalLgdCode,
    iso_code: optionalStateIsoCode,
  })
  .strict();

export class CreateStateDto extends createZodDto(CreateStateSchema) {}
