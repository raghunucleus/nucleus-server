import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { strongPasswordSchema } from '../../student/dto/password.schema';

// Admin password actions are keyed by mobile number (the login identity).
export const SetGuardianPasswordSchema = z.object({
  mobile_number: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  password: strongPasswordSchema,
});

export class SetGuardianPasswordDto extends createZodDto(
  SetGuardianPasswordSchema,
) {}

export const GuardianMobileSchema = z.object({
  mobile_number: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
});

export class GuardianMobileDto extends createZodDto(GuardianMobileSchema) {}
