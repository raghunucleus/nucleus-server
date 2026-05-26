import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { strongPasswordSchema } from '../../employee/auth/dto/password.schema';

export const SetEmployeePasswordSchema = z.object({
  // Same strength policy an employee must meet when choosing their own password.
  password: strongPasswordSchema,
});

export class SetEmployeePasswordDto extends createZodDto(
  SetEmployeePasswordSchema,
) {}
