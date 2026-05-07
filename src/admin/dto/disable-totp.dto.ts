import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DisableTotpSchema = z.object({
  password: z.string().min(8).max(128),
  // 6-digit TOTP or 8-char recovery code (with optional dash).
  code: z.string().min(6).max(16),
});

export class DisableTotpDto extends createZodDto(DisableTotpSchema) {}
