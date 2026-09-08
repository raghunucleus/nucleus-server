import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ValidateInviteSchema = z.object({
  token: z.string().trim().min(1).max(256),
});

export class ValidateInviteDto extends createZodDto(ValidateInviteSchema) {}
