import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateAttendanceGroupSchema = z
  .object({
    programme_id: z.coerce.number().int().positive(),
    admission_year_id: z.coerce.number().int().positive(),
    name: z.string().trim().min(1).max(64),
    // Short identifier unique within the programme × admission-year batch.
    code: z.string().trim().min(1).max(32),
    // Optional — empty/missing is normalised to null.
    description: z
      .string()
      .trim()
      .max(256)
      .optional()
      .transform((v) => (v && v.length > 0 ? v : null)),
  })
  .strict();

export class CreateAttendanceGroupDto extends createZodDto(
  CreateAttendanceGroupSchema,
) {}
