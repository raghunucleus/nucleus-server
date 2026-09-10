import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DeviceFieldsShape } from '../../auth-sessions/dto/device-fields.schema';

export const GuardianLoginSchema = z.object({
  // Indian mobile number, no country code — the guardian's login identifier.
  mobile_number: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  // Accept any non-empty string here; the real strength policy is enforced
  // only when a password is *set*. Failing closed avoids leaking the policy.
  password: z.string().min(1).max(128),
  ...DeviceFieldsShape,
});

export class GuardianLoginDto extends createZodDto(GuardianLoginSchema) {}
