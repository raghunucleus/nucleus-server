import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { strongPasswordSchema } from './password.schema';

export const StudentResetPasswordSchema = z.object({
  token: z.string().trim().min(1).max(256),
  newPassword: strongPasswordSchema,
});

export class StudentResetPasswordDto extends createZodDto(
  StudentResetPasswordSchema,
) {}
