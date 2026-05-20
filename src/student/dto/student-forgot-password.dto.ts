import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const StudentForgotPasswordSchema = z.object({
  // Either the roll number or the registered email — resolved server-side.
  identifier: z.string().trim().min(1).max(255),
});

export class StudentForgotPasswordDto extends createZodDto(
  StudentForgotPasswordSchema,
) {}
