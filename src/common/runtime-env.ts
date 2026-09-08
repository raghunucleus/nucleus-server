/**
 * The single source of truth for "which environment are we in".
 *
 * Several controls key off `NODE_ENV`, and they historically each spelled the
 * comparison out by hand:
 *
 *   - `main.ts`         `NODE_ENV === 'dev'`        → CORS reflects any origin
 *   - `app.module.ts`   `NODE_ENV === 'dev'`        → FakeDelayMiddleware
 *   - `mail.service.ts` `NODE_ENV === 'dev'`        → mail captured to dev_mail_outbox
 *   - `app.module.ts`   `NODE_ENV === 'production'` → pino level + transport
 *
 * The security-relevant ones all test for `dev`, so they already fail closed on
 * a typo. The logging one tests for `production` and does not — `NODE_ENV=prod`
 * gets you a locked-down CORS allowlist while pino still runs the pretty-print
 * transport at debug level. Routing everything through these helpers keeps the
 * two families from drifting apart, and gives Swagger gating an `isProduction()`
 * that means the same thing as everyone else's.
 *
 * Two rules:
 *
 * 1. **Unset means `dev`** — the documented project default (see sample.env), so
 *    a fresh clone still boots with no env at all.
 * 2. **Unrecognised means `production`** — the strictest branch, so a typo can
 *    never hand you the permissive one. `validateEnv` additionally refuses to
 *    boot on an unrecognised value, so you find out at startup rather than
 *    inferring it from behaviour three days later.
 *
 * Read through these helpers only — never `process.env.NODE_ENV` directly.
 */

export const NODE_ENVS = ['dev', 'test', 'staging', 'production'] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];

/** True when `value` is one of the four environments we recognise. */
export function isKnownNodeEnv(value: string): value is NodeEnv {
  return (NODE_ENVS as readonly string[]).includes(value);
}

/**
 * The current environment. Read live from `process.env` (not captured at import
 * time) so tests can flip it with `process.env.NODE_ENV = ...`.
 *
 * Unset/empty → `dev`. Anything unrecognised → `production`.
 */
export function nodeEnv(): NodeEnv {
  const raw = (process.env.NODE_ENV ?? '').trim();
  if (raw === '') return 'dev';
  return isKnownNodeEnv(raw) ? raw : 'production';
}

export function isProduction(): boolean {
  return nodeEnv() === 'production';
}

export function isDev(): boolean {
  return nodeEnv() === 'dev';
}

export function isTest(): boolean {
  return nodeEnv() === 'test';
}
