import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { EMPLOYEE_NOTIFICATION_MODULE_KEYS } from '../employee-notification.types';

/** Body of POST /employee/notifications/push-tokens — register this device. */
export const RegisterPushTokenSchema = z.object({
  expoPushToken: z.string().trim().min(1).max(255),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  deviceId: z.string().trim().min(1).max(128).optional(),
});
export class RegisterPushTokenDto extends createZodDto(
  RegisterPushTokenSchema,
) {}

/** Body of DELETE /employee/notifications/push-tokens — drop this device. */
export const UnregisterPushTokenSchema = z.object({
  expoPushToken: z.string().trim().min(1).max(255),
});
export class UnregisterPushTokenDto extends createZodDto(
  UnregisterPushTokenSchema,
) {}

/**
 * Body of PATCH /employee/notifications/preferences/:moduleKey. Both channels
 * are optional — an omitted one keeps its current effective value. In-app is
 * absent by design: it cannot be switched off.
 */
export const UpdateNotificationPreferenceSchema = z
  .object({
    email_enabled: z.boolean().optional(),
    push_enabled: z.boolean().optional(),
  })
  .refine((v) => v.email_enabled !== undefined || v.push_enabled !== undefined, {
    message: 'Provide at least one of email_enabled or push_enabled.',
  });
export class UpdateNotificationPreferenceDto extends createZodDto(
  UpdateNotificationPreferenceSchema,
) {}

/** Validates the :moduleKey path param against the known module keys. */
export const EmployeeNotificationModuleKeySchema = z.enum(
  EMPLOYEE_NOTIFICATION_MODULE_KEYS as unknown as [string, ...string[]],
);
