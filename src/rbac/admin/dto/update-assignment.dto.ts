import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateAssignmentSchema = z.object({
  // If supplied, fully replaces the assignment's attribute set.
  attributes: z
    .array(
      z.object({
        screen_key: z.string().min(1).max(128),
        attribute_key: z.string().min(1).max(64),
        value: z.unknown(),
      }),
    )
    .max(1024)
    .optional(),
});

export class UpdateAssignmentDto extends createZodDto(UpdateAssignmentSchema) {}
