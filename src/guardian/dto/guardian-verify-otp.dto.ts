import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { strongPasswordSchema } from '../../student/dto/password.schema';

export const GuardianVerifyOtpSchema = z.object({
  mobile_number: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: strongPasswordSchema,
});

export class GuardianVerifyOtpDto extends createZodDto(
  GuardianVerifyOtpSchema,
) {}
