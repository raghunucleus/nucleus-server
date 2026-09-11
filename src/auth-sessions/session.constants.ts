import type { SessionAudience } from './auth-session.entity';

/**
 * How many devices a student, employee or parent may keep signed in at once.
 * Employees can be raised individually through `employees.device_limit`
 * (NULL = this default); students and parents always get the default.
 * Enforced at login: the at-limit picker makes the person sign a device out
 * before the new login completes — nothing is ever evicted automatically.
 */
export const DEFAULT_DEVICE_LIMIT = 2;

/** Upper bound for an admin-set `employees.device_limit` (CHECK in the DB). */
export const MAX_DEVICE_LIMIT = 20;

/**
 * How long a session row is kept past `expires_at` before the daily cleanup
 * cron deletes it. Revoked rows age out on the same clock — `expires_at`
 * stops rolling forward once a session is revoked.
 */
export const SESSION_RETENTION_DAYS = 30;

/**
 * How long the previous refresh jti stays acceptable after a rotation. Two
 * tabs (or two refresh call sites in one app) share one refresh token, and
 * both refreshing at nearly the same moment is normal — the loser presents the
 * just-rotated-out jti. Within this window it gets the CURRENT jti re-issued
 * instead of a reuse burn; a stolen token replayed later still lands outside.
 */
export const ROTATION_GRACE_SECONDS = 60;

/** Lifetime of the single-use token the device-limit picker completes with. */
export const DEVICE_LIMIT_CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Config keys (and fallbacks) for each audience's token lifetimes. The refresh
 * TTL is also the session's sliding `expires_at`, so both the JWT and the row
 * must read it from here.
 */
export const SESSION_TTL_CONFIG: Record<
  SessionAudience,
  { access: [string, string]; refresh: [string, string] }
> = {
  student: {
    access: ['JWT_STUDENT_ACCESS_TTL', '15m'],
    refresh: ['JWT_STUDENT_REFRESH_TTL', '7d'],
  },
  employee: {
    access: ['JWT_EMPLOYEE_ACCESS_TTL', '15m'],
    refresh: ['JWT_EMPLOYEE_REFRESH_TTL', '30d'],
  },
  guardian: {
    access: ['JWT_GUARDIAN_ACCESS_TTL', '15m'],
    refresh: ['JWT_GUARDIAN_REFRESH_TTL', '7d'],
  },
};

/**
 * Redis key for an individually killed session, checked (EXISTS) by each JWT
 * strategy on every request and by the socket gateways at handshake — this is
 * what makes a kill bite before the access token's own expiry. Written ONLY by
 * `AuthSessionsService`; the client's `keyPrefix` namespaces it, so never add
 * the `nucleus:` prefix here.
 */
export function revokedSidKey(audience: SessionAudience, sid: string): string {
  return `${audience}:sid:revoked:${sid}`;
}

/** The socket.io room every socket of one session joins at handshake. */
export function sessionRoom(sid: string): string {
  return `session:${sid}`;
}
