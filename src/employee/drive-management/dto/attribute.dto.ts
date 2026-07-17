import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Create/edit one lookup value (a drive attribute). One schema serves every
 * kind: `is_internship` / `is_full_time` only mean anything for `offer-types`,
 * `min_lpa` / `max_lpa` only for `placement-categories`, and the service ignores
 * each for the other kinds. The cross-field rules ("at least one flag", "min
 * below max") live in the service, where the kind is known.
 *
 * The salary bounds are `.nullable()` on purpose: null clears a bound to
 * open-ended, which is a real edit and distinct from omitting the field.
 */
export const DriveLookupSchema = z.object({
  name: z.string().trim().min(1).max(128),
  sort_order: z.coerce.number().int().min(0).optional(),
  is_internship: z.coerce.boolean().optional(),
  is_full_time: z.coerce.boolean().optional(),
  min_lpa: z.coerce.number().min(0).max(9999.99).nullable().optional(),
  max_lpa: z.coerce.number().min(0).max(9999.99).nullable().optional(),
});
export class DriveLookupDto extends createZodDto(DriveLookupSchema) {}

export const UpdateDriveLookupSchema = DriveLookupSchema.partial();
export class UpdateDriveLookupDto extends createZodDto(
  UpdateDriveLookupSchema,
) {}

/** Activate / deactivate a lookup value. */
export const DriveLookupStatusSchema = z.object({
  is_active: z.coerce.boolean(),
});
export class DriveLookupStatusDto extends createZodDto(
  DriveLookupStatusSchema,
) {}
