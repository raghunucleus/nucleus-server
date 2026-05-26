import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// `value` is intentionally loose here — the server validates the shape
// against the catalog (single vs multi, attribute type) in the service.
export const CreateAssignmentSchema = z.object({
  role_id: z.coerce.number().int().positive(),
  employee_id: z.coerce.number().int().positive(),
  attributes: z
    .array(
      z.object({
        screen_key: z.string().min(1).max(128),
        attribute_key: z.string().min(1).max(64),
        value: z.unknown(),
      }),
    )
    .max(1024)
    .default([]),
});

export class CreateAssignmentDto extends createZodDto(CreateAssignmentSchema) {}
