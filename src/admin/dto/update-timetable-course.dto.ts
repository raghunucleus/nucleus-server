import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Switches an exclusive course between a master subject and a free-text
// label. The service re-checks that exactly one of the two ends up set.
export const UpdateTimetableCourseSchema = z
  .object({
    subject_id: z.coerce.number().int().positive().nullable().optional(),
    custom_label: z.string().trim().min(1).max(96).nullable().optional(),
  })
  .strict();

export class UpdateTimetableCourseDto extends createZodDto(
  UpdateTimetableCourseSchema,
) {}
