import { Redis } from 'ioredis';

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

/** Deletes every refresh-token family for one subject, signing them out everywhere. */
export async function revokeAllSessions(
  redis: Redis,
  prefix: string,
  subjectId: number,
): Promise<void> {
  const stream = redis.scanStream({
    match: refreshFamilyKey(prefix, subjectId, '*'),
    count: 100,
  });
  for await (const keys of stream) {
    if ((keys as string[]).length) {
      await redis.del(...(keys as string[]));
    }
  }
}
