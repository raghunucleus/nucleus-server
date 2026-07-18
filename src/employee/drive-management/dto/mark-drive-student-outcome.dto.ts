import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_IMPORT_STUDENT_IDS } from './import-drive-students.dto';

/**
 * Drive-day outcome for ACCEPTED (30) students: 50 Not Attended, 60 Selected,
 * 70 Not Selected. Literals rather than z.number() so an unknown code is a 400,
 * not a silently-stored garbage status.
 */
export const MarkDriveStudentOutcomeSchema = z.object({
  student_ids: z
    .array(z.coerce.number().int().positive())
    .min(1)
    .max(MAX_IMPORT_STUDENT_IDS),
  status: z.union([z.literal(50), z.literal(60), z.literal(70)]),
});

export class MarkDriveStudentOutcomeDto extends createZodDto(
  MarkDriveStudentOutcomeSchema,
) {}
