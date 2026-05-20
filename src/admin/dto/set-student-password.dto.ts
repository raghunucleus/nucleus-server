import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { strongPasswordSchema } from '../../student/dto/password.schema';

export const SetStudentPasswordSchema = z.object({
  // Same strength policy a student must meet when choosing their own password.
  password: strongPasswordSchema,
});

export class SetStudentPasswordDto extends createZodDto(
  SetStudentPasswordSchema,
) {}
