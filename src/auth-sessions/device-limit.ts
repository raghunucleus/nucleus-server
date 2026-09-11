import { ConflictException } from '@nestjs/common';
import type { AuthSession } from './auth-session.entity';

/**
 * The pre-auth projection of one occupying session — the minimum a person
 * needs to choose which device to sign out. Deliberately no IP.
 */
export interface DeviceLimitSessionSummary {
  id: string;
  device_name: string;
  created_at: string;
  last_used_at: string;
}

/** Body of the 409 a login gets when every device slot is taken. */
export interface DeviceLimitResponse {
  statusCode: 409;
  code: 'DEVICE_LIMIT';
  message: string;
  challengeToken: string;
  limit: number;
  sessions: DeviceLimitSessionSummary[];
}

export function toDeviceSummary(s: AuthSession): DeviceLimitSessionSummary {
  return {
    id: s.id,
    device_name: s.device_name,
    created_at: s.created_at.toISOString(),
    last_used_at: s.last_used_at.toISOString(),
  };
}

/**
 * Pause a login at the device limit. A 409 rather than a 200 union so an
 * outdated client that doesn't know the picker shows `message` instead of
 * storing a response with no tokens in it. Current clients key off `code`.
 *
 * `challengeToken` is a bearer credential: `err.response.challengeToken` is
 * redacted in the pino config (app.module.ts) because the error interceptor
 * logs the thrown response.
 */
export function throwDeviceLimit(
  challengeToken: string,
  limit: number,
  active: AuthSession[],
): never {
  const body: DeviceLimitResponse = {
    statusCode: 409,
    code: 'DEVICE_LIMIT',
    message:
      `Device limit reached — you're signed in on ${active.length} of ` +
      `${limit} allowed devices. Sign out on one of them, or update the app ` +
      `to choose a device to sign out from here.`,
    challengeToken,
    limit,
    sessions: active.map(toDeviceSummary),
  };
  throw new ConflictException(body);
}
