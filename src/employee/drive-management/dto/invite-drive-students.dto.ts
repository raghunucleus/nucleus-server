import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_IMPORT_STUDENT_IDS } from './import-drive-students.dto';

/**
 * Record-level (or batch) invite: explicit student ids from the Students tab.
 * "Invite all imported" does NOT go through here — it hits `invite-all` with no
 * body so the server derives the status-10 set itself.
 */
export const InviteDriveStudentsSchema = z.object({
  student_ids: z
    .array(z.coerce.number().int().positive())
    .min(1)
    .max(MAX_IMPORT_STUDENT_IDS),
});

export class InviteDriveStudentsDto extends createZodDto(
  InviteDriveStudentsSchema,
) {}
