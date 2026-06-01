import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { OTP_CHANNEL_KEYS } from '../entities/guardian-otp.entity';

export const GuardianRequestOtpSchema = z.object({
  mobile_number: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  // Optional preferred delivery channel. Ignored if not usable (e.g. 'email'
  // requested but no email on file); the service falls back to the first
  // usable channel.
  channel: z.enum(OTP_CHANNEL_KEYS).optional(),
});

export class GuardianRequestOtpDto extends createZodDto(
  GuardianRequestOtpSchema,
) {}
