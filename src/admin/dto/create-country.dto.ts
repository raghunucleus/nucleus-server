import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  optionalDialCode,
  optionalIso2,
  optionalIso3,
} from './address-attribute-fields.dto';

export const CreateCountrySchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    iso2: optionalIso2,
    iso3: optionalIso3,
    dial_code: optionalDialCode,
  })
  .strict();

export class CreateCountryDto extends createZodDto(CreateCountrySchema) {}
