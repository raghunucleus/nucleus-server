import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Body of POST /student/notifications/push-tokens — register this device. */
export const RegisterPushTokenSchema = z.object({
  expoPushToken: z.string().trim().min(1).max(255),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  deviceId: z.string().trim().min(1).max(128).optional(),
});
export class RegisterPushTokenDto extends createZodDto(
  RegisterPushTokenSchema,
) {}

/** Body of DELETE /student/notifications/push-tokens — drop this device. */
export const UnregisterPushTokenSchema = z.object({
  expoPushToken: z.string().trim().min(1).max(255),
});
export class UnregisterPushTokenDto extends createZodDto(
  UnregisterPushTokenSchema,
) {}
