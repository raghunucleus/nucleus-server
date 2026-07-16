import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  optionalDialCode,
  optionalIso2,
  optionalIso3,
} from './address-attribute-fields.dto';

export const UpdateCountrySchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    // Already optional and null-accepting — pass `null` to clear, omit to keep.
    iso2: optionalIso2,
    iso3: optionalIso3,
    dial_code: optionalDialCode,
  })
  .strict();

export class UpdateCountryDto extends createZodDto(UpdateCountrySchema) {}
