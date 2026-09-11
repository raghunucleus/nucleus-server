import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DeviceFieldsShape } from '../../../auth-sessions/dto/device-fields.schema';

export const EmployeeLoginSchema = z.object({
  // The employee code (employees.emp_code). Normalised to upper-case to match
  // how employee records are stored.
  emp_code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((v) => v.toUpperCase()),
  // Accept any non-empty string here; the real strength policy is enforced
  // only when a password is *set*. Failing closed avoids leaking the policy.
  password: z.string().min(1).max(128),
  ...DeviceFieldsShape,
});

export class EmployeeLoginDto extends createZodDto(EmployeeLoginSchema) {}
