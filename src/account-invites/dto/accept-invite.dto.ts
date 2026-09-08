import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
// The employee copy of this schema is identical; one endpoint serves both
// audiences, so it has to pick one. If the two ever diverge, the invite path
// must move to whichever is stricter rather than silently enforcing one
// audience's policy on the other.
import { strongPasswordSchema } from '../../student/dto/password.schema';

export const AcceptInviteSchema = z.object({
  token: z.string().trim().min(1).max(256),
  newPassword: strongPasswordSchema,
});

export class AcceptInviteDto extends createZodDto(AcceptInviteSchema) {}
