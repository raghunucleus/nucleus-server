import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Denying an invite requires a reason — it's shown to the placement cell. */
export const RejectDriveInviteSchema = z.object({
  reason: z.string().trim().min(1).max(512),
});

export class RejectDriveInviteDto extends createZodDto(
  RejectDriveInviteSchema,
) {}
