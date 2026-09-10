import { Redis } from 'ioredis';
import { REDIS_KEY_PREFIX } from '../redis/redis-namespace';

/**
 * Pattern-deletes keys, compensating for the client-level `keyPrefix`.
 *
 * (Student / employee / parent sessions no longer live in Redis — they are
 * `auth_sessions` rows owned by `AuthSessionsService`. This helper remains for
 * the admin refresh-token keys and any other pattern delete.)
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
