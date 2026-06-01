import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { strongPasswordSchema } from '../../student/dto/password.schema';

export const GuardianChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPasswordSchema,
});

export class GuardianChangePasswordDto extends createZodDto(
  GuardianChangePasswordSchema,
) {}
