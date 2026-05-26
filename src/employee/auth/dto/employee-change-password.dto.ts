import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { strongPasswordSchema } from './password.schema';

export const EmployeeChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPasswordSchema,
});

export class EmployeeChangePasswordDto extends createZodDto(
  EmployeeChangePasswordSchema,
) {}
