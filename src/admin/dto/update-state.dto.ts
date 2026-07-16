import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  optionalLgdCode,
  optionalStateIsoCode,
} from './address-attribute-fields.dto';

export const UpdateStateSchema = z
  .object({
    // Optional so a state can be re-parented to a different country. The
    // service re-checks UQ_states_country_id_name against the effective parent
    // whenever either country_id or name moves.
    country_id: z.coerce.number().int().positive().optional(),
    name: z.string().trim().min(1).max(128).optional(),
    // Already optional and null-accepting — pass `null` to clear, omit to keep.
    lgd_code: optionalLgdCode,
    iso_code: optionalStateIsoCode,
  })
  .strict();

export class UpdateStateDto extends createZodDto(UpdateStateSchema) {}
