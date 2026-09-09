import { Redis } from 'ioredis';
import { REDIS_KEY_PREFIX } from '../redis/redis-namespace';

/**
 * Redis key namespace for refresh-token families, and the one way to wipe them.
 *
 * Each audience stores `<prefix>:<subjectId>:<familyId>` → the family's current
 * jti, so revoking every session for a person means deleting every key matching
 * that person's prefix. The auth services own their own login flows, but the
 * key *format* has to be shared: anything that invalidates a password (a reset,
 * an admin provision, an accepted invite) must be able to find those keys, and
 * a prefix that drifts in one caller means sessions silently survive a
 * credential change.
 */
export const REFRESH_FAMILY_PREFIX = {
  employee: 'employee:rt',
  student: 'student:rt',
} as const;

export type RefreshFamilyPrefix =
  (typeof REFRESH_FAMILY_PREFIX)[keyof typeof REFRESH_FAMILY_PREFIX];

export function refreshFamilyKey(
  prefix: string,
  subjectId: number,
  familyId: string,
): string {
  return `${prefix}:${subjectId}:${familyId}`;
}

/**
 * Pattern-deletes keys, compensating for the client-level `keyPrefix`.
 *
 * This is the ONE place allowed to call `scanStream`, because a naive
 * scan-then-delete is silently wrong once `keyPrefix` is set — in two ways:
 *
 * 1. `MATCH` is an argument, not a key, so ioredis does not prefix it. A raw
 *    pattern therefore matches none of our (prefixed) keys and quietly deletes
 *    nothing — which for session revocation means failing OPEN.
 * 2. `SCAN` returns fully-qualified keys, prefix included. Feeding those back
 *    into `del` — which DOES prefix — would produce `nucleus:nucleus:...`.
 *
 * So: add the prefix to the pattern going in, strip it off the keys coming
 * back. Callers pass the logical pattern, without the prefix, exactly as they
 * would write any other key.
 */
export async function scanAndDelete(
  redis: Redis,
  match: string,
): Promise<void> {
  const stream = redis.scanStream({
    match: `${REDIS_KEY_PREFIX}${match}`,
    count: 100,
  });
  for await (const found of stream) {
    const keys = (found as string[]).map((key) =>
      key.startsWith(REDIS_KEY_PREFIX)
        ? key.slice(REDIS_KEY_PREFIX.length)
        : key,
    );
    if (keys.length) {
      await redis.del(...keys);
    }
  }
}

/** Deletes every refresh-token family for one subject, signing them out everywhere. */
export async function revokeAllSessions(
  redis: Redis,
  prefix: string,
  subjectId: number,
): Promise<void> {
  await scanAndDelete(redis, refreshFamilyKey(prefix, subjectId, '*'));
}
