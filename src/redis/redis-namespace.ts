/**
 * The namespace every Redis key and pub/sub channel this app owns lives under.
 *
 * The Redis instance is SHARED with `central-server`, which was deployed first
 * and writes raw, unprefixed keys to the same DB 0. Central already owns the
 * bare `admin:`, `employee:`, `client:`, `mcp:`, `mfa:`, `rbac:`, `presence:`,
 * `flow:`, `idem:`, `throttle:`, `cron-claim:` and `reminders:` namespaces — and
 * several of its keys were byte-identical to ours before this prefix existed
 * (`employee:rl:forgot-ip:<ip>`, `employee:rl:login:<ip>`, `admin:rl:login:<ip>`
 * and friends). Both apps serve the same college, so the same office IPs and
 * the same employee emails land in both: shared rate-limit counters meant
 * spurious 429s in one app caused by traffic in the other.
 *
 * This is a hardcoded constant rather than an env var deliberately — a prefix
 * that can be misconfigured to empty is a prefix that can silently collide.
 *
 * It is applied in exactly two places, and they are NOT interchangeable:
 *
 * 1. `keyPrefix` on the one ioredis client (`redis.module.ts`), which rewrites
 *    the keys of every command — `get`/`set`/`del`/`incr`/`expire`/`eval`.
 * 2. The `key` option on the Socket.IO Redis adapter (`redis-io.adapter.ts`).
 *    ioredis does NOT prefix pub/sub channels, because channels are not keys,
 *    so the adapter has to be namespaced by hand.
 *
 * The one thing `keyPrefix` breaks is `SCAN`: its `MATCH` pattern is an
 * argument rather than a key, so ioredis leaves it alone. See `scanAndDelete`
 * in `src/common/session-keys.ts` — always use that instead of `scanStream`.
 */
export const REDIS_KEY_PREFIX = 'nucleus:';
