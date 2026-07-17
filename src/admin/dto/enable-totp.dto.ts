import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EnableTotpSchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator'),
});

export class EnableTotpDto extends createZodDto(EnableTotpSchema) {}
