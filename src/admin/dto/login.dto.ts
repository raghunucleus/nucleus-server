import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const LoginSchema = z.object({
  identifier: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
});

export class LoginDto extends createZodDto(LoginSchema) {}
