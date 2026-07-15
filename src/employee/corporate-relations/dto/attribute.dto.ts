import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Create/edit one lookup value (a company attribute). */
export const LookupSchema = z.object({
  name: z.string().trim().min(1).max(128),
  sort_order: z.coerce.number().int().min(0).optional(),
});
export class LookupDto extends createZodDto(LookupSchema) {}

export const UpdateLookupSchema = LookupSchema.partial();
export class UpdateLookupDto extends createZodDto(UpdateLookupSchema) {}

/** Activate / deactivate a lookup value. */
export const LookupStatusSchema = z.object({
  is_active: z.coerce.boolean(),
});
export class LookupStatusDto extends createZodDto(LookupStatusSchema) {}
