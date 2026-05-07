import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const VerifyTwoFactorSchema = z.object({
  challengeToken: z.string().min(1).max(128),
  // Either a 6-digit TOTP or an 8-character recovery code (with optional dash).
  code: z.string().min(6).max(16),
});

export class VerifyTwoFactorDto extends createZodDto(VerifyTwoFactorSchema) {}
