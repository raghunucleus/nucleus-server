import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class RequestPersonalEmailOtpDto extends createZodDto(
  z
    .object({
      email: z
        .string()
        .trim()
        .max(255)
        .email()
        .transform((v) => v.toLowerCase()),
    })
    .strict(),
) {}

export class VerifyPersonalEmailOtpDto extends createZodDto(
  z
    .object({
      code: z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'Enter the 6-digit code'),
    })
    .strict(),
) {}
