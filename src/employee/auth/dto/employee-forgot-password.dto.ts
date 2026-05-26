import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EmployeeForgotPasswordSchema = z.object({
  // Either the employee code or the registered email — resolved server-side.
  identifier: z.string().trim().min(1).max(255),
});

export class EmployeeForgotPasswordDto extends createZodDto(
  EmployeeForgotPasswordSchema,
) {}
