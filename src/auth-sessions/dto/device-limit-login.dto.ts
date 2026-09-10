import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DeviceFieldsShape } from './device-fields.schema';

/**
 * Finish a login the device limit paused: sign the chosen devices out, then
 * run the gate again. Same body for every audience's `login/device-limit`.
 */
export const DeviceLimitLoginSchema = z.object({
  /** From the 409 `DEVICE_LIMIT` response. Single-use, 5 minute TTL. */
  challengeToken: z.string().min(1).max(256),
  /** Session ids (from that response) to sign out before continuing. */
  sessionIds: z.array(z.string().uuid()).min(1).max(20),
  ...DeviceFieldsShape,
});

export class DeviceLimitLoginDto extends createZodDto(DeviceLimitLoginSchema) {}

/** The parsed body, as the auth services consume it. */
export type DeviceLimitLoginInput = z.infer<typeof DeviceLimitLoginSchema>;
