import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { optionalLgdCode } from './address-attribute-fields.dto';

export const UpdateDistrictSchema = z
  .object({
    // Optional so a district can be re-parented to a different state. The
    // service re-checks UQ_districts_state_id_name against the effective parent
    // whenever either state_id or name moves.
    state_id: z.coerce.number().int().positive().optional(),
    name: z.string().trim().min(1).max(128).optional(),
    // Already optional and null-accepting — pass `null` to clear, omit to keep.
    lgd_code: optionalLgdCode,
  })
  .strict();

export class UpdateDistrictDto extends createZodDto(UpdateDistrictSchema) {}
