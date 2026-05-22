import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UpdateAttendanceGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    // Optional — empty/missing is normalised to null (clears the description).
    description: z
      .string()
      .trim()
      .max(256)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .strict();

export class UpdateAttendanceGroupDto extends createZodDto(
  UpdateAttendanceGroupSchema,
) {}
