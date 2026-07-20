import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_IMPORT_STUDENT_IDS } from './import-drive-students.dto';

/**
 * Which channels the invitation/reminder goes out on. Optional: omitted, the
 * notification service applies its default (in-app + push, no email), so older
 * clients keep working. Supplied, at least one must be on — an all-off send is
 * a no-op the employee would be told succeeded.
 */
export const InviteChannelsSchema = z
  .object({
    in_app: z.boolean().default(false),
    push: z.boolean().default(false),
    email: z.boolean().default(false),
  })
  .strict()
  .refine(
    (c) => c.in_app || c.push || c.email,
    'Pick at least one delivery channel.',
  );

/**
 * Record-level (or batch) invite: explicit student ids from the Students tab.
 * "Invite all imported" does NOT go through here — it hits `invite-all`, whose
 * body carries only the channels so the server derives the status-10 set itself.
 */
export const InviteDriveStudentsSchema = z.object({
  student_ids: z
    .array(z.coerce.number().int().positive())
    .min(1)
    .max(MAX_IMPORT_STUDENT_IDS),
  channels: InviteChannelsSchema.optional(),
});

export class InviteDriveStudentsDto extends createZodDto(
  InviteDriveStudentsSchema,
) {}

/** `invite-all` takes no ids — only the delivery channels. */
export const InviteAllDriveStudentsSchema = z.object({
  channels: InviteChannelsSchema.optional(),
});

export class InviteAllDriveStudentsDto extends createZodDto(
  InviteAllDriveStudentsSchema,
) {}
