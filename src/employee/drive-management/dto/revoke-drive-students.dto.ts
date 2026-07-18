import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_IMPORT_STUDENT_IDS } from './import-drive-students.dto';

/**
 * Revoke pulls Invited/Accepted students out of the drive. A reason is required
 * (shown to the student and recorded in the audit trail); `notify` lets the
 * acting employee decide whether to push a notification.
 */
export const RevokeDriveStudentsSchema = z.object({
  student_ids: z
    .array(z.coerce.number().int().positive())
    .min(1)
    .max(MAX_IMPORT_STUDENT_IDS),
  reason: z.string().trim().min(1).max(512),
  notify: z.boolean().optional().default(true),
});

export class RevokeDriveStudentsDto extends createZodDto(
  RevokeDriveStudentsSchema,
) {}
