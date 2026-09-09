import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { NODE_ENVS, isKnownNodeEnv } from '../common/runtime-env';

/**
 * Boot-time environment validation, wired into `ConfigModule.forRoot({ validate })`.
 *
 * The point is to turn "misconfigured production" from a silent downgrade into a
 * **refusal to start**. Every rule below exists because the broken state was
 * previously reachable and invisible:
 *
 *   - `CORS_ORIGINS` is read by `main.ts` but appears in neither `.env` nor
 *     `sample.env`, so an unset value in production silently allowlists only
 *     `http://localhost:5000` and friends — every browser call from the real
 *     portals fails, and the only symptom is a CORS error in the console.
 *   - `SENDGRID_API_KEY` unset outside dev makes `MailService` *log* every mail
 *     and drop it. The app boots green and looks healthy while no student can
 *     reset a password and no guardian ever receives an OTP.
 *   - Most `JWT_*_REFRESH_SECRET`s and `SECURITY_PASS_SECRET` are read through
 *     `getOrThrow` at **first use**, not at boot. Missing, they start fine and
 *     500 the first time somebody refreshes a session or scans an ID card.
 *   - Nothing ever checked that the eight JWT secrets were distinct. Reusing one
 *     across audiences means a student access token verifies as an admin token —
 *     a full privilege-escalation path across four separate auth realms.
 *   - `S3_ACCESS_KEY` / `S3_SECRET_KEY` are either BOTH set (static keys) or
 *     BOTH empty (the instance IAM role, via the SDK's default provider chain).
 *     A half-set pair would only surface as a runtime upload failure.
 *
 * Dev stays frictionless: outside production only the shape is checked, so a
 * fresh clone with `sample.env` boots unchanged.
 */

/** Anything shorter is brute-forceable; 32 bytes is the floor for HS256. */
const MIN_SECRET_LENGTH = 32;

/**
 * The eight auth secrets — four audiences × (access, refresh) — plus the
 * security-pass signer. All nine must differ from one another.
 *
 * Nucleus has more of these than most apps because admin, student, guardian and
 * employee are genuinely separate realms with separate login screens, separate
 * token storage and separate guards. That separation is only real if the signing
 * keys differ: a shared secret collapses four audiences into one.
 */
const SECRET_KEYS = [
  'JWT_ADMIN_ACCESS_SECRET',
  'JWT_ADMIN_REFRESH_SECRET',
  'JWT_STUDENT_ACCESS_SECRET',
  'JWT_STUDENT_REFRESH_SECRET',
  'JWT_GUARDIAN_ACCESS_SECRET',
  'JWT_GUARDIAN_REFRESH_SECRET',
  'JWT_EMPLOYEE_ACCESS_SECRET',
  'JWT_EMPLOYEE_REFRESH_SECRET',
  'SECURITY_PASS_SECRET',
] as const;

/**
 * The URLs every emailed link is built from, with a representative value for
 * the error message — naming the right portal matters when an operator is
 * reading nineteen of these at once.
 */
const APP_URL_KEYS = {
  STUDENT_APP_URL: 'https://student.example.com',
  EMPLOYEE_APP_URL: 'https://employee.example.com',
} as const;

/** Credentials that ship as dev defaults and must never reach production. */
const KNOWN_DEV_CREDENTIALS = new Set([
  'nucleus',
  'nucleus_dev_pw',
  'redis_dev_pw',
  'postgres',
  'minioadmin',
]);

/**
 * Read but never referenced anywhere in `src/` — a value nobody consumes.
 * Currently empty (API_PUBLIC_BASE_URL is consumed again by MailService for
 * the email logo); the warning below stays so the next dead key is caught.
 */
const DEAD_KEYS: readonly string[] = [];

/** The shape `parseDurationToSeconds` accepts: "30", "15m", "7d", "48h". */
const durationSchema = z
  .string()
  .regex(
    /^\d+\s*[smhd]?$/,
    'must look like "7d", "48h", "30m" or a bare number of seconds',
  );

const baseSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).optional(),

    POSTGRES_USER: z.string().min(1, 'POSTGRES_USER is required'),
    POSTGRES_PASSWORD: z.string().min(1, 'POSTGRES_PASSWORD is required'),
    POSTGRES_DB: z.string().min(1, 'POSTGRES_DB is required'),

    CORS_ORIGINS: z.string().optional(),
    TRUST_PROXY: z.string().optional(),

    // Durations are parsed by parseDurationToSeconds, which silently returns
    // its fallback for anything malformed — so "7 days" typed here would
    // quietly become the default with no signal. Checked in every environment,
    // not just production, because that is exactly the silent downgrade this
    // file exists to turn into a refusal to start.
    STUDENT_ACCOUNT_INVITE_TTL: durationSchema.optional(),
    EMPLOYEE_ACCOUNT_INVITE_TTL: durationSchema.optional(),
    ACCOUNT_INVITE_RESEND_COOLDOWN: durationSchema.optional(),
    ACCOUNT_INVITE_MAX_BATCH: z.coerce
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional(),
  })
  // Everything else in the environment passes through untouched — this schema
  // validates a subset, it does not enumerate the full surface.
  .loose();

/**
 * Collects every problem before throwing, so a misconfigured deploy gets one
 * complete list instead of a fix-restart-repeat loop.
 */
function productionIssues(env: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const read = (key: string): string =>
    typeof env[key] === 'string' ? env[key].trim() : '';

  // --- CORS ---------------------------------------------------------------
  const corsOrigins = read('CORS_ORIGINS');
  if (corsOrigins === '') {
    issues.push(
      'CORS_ORIGINS must be set in production (comma-separated list of the exact portal ' +
        'origins). Unset falls back to the localhost:5000 dev origins, which rejects every ' +
        'request from the real admin/employee/parent/student portals.',
    );
  } else if (corsOrigins.split(',').some((o) => o.trim() === '*')) {
    issues.push(
      'CORS_ORIGINS must not contain "*" — it would let any site read authenticated ' +
        'responses from a logged-in user\'s browser.',
    );
  }

  // --- App URLs -----------------------------------------------------------
  // Password-reset and temp-password emails build their links from these, and
  // EMPLOYEE_APP_URL is additionally parsed with `new URL()`. Unset or relative,
  // every emailed link points at the dev default and 404s for real users.
  for (const [key, example] of Object.entries(APP_URL_KEYS)) {
    const value = read(key);
    if (value === '') {
      issues.push(
        `${key} must be set in production (the portal origin, e.g. ${example}). ` +
          'Password-reset, temp-password and account-invite emails all build ' +
          'their links from it.',
      );
    } else if (!/^https?:\/\/[^\s/]+/.test(value)) {
      issues.push(
        `${key} must be an absolute http(s) URL (got "${value}") — an emailed link has no ` +
          'page to be relative to.',
      );
    }
  }

  // --- API public origin --------------------------------------------------
  // Optional (unset → text-only email header, warned about below), but when
  // set it must be absolute: it becomes the `src` of the logo in every email.
  const apiBase = read('API_PUBLIC_BASE_URL');
  if (apiBase !== '' && !/^https?:\/\/[^\s/]+/.test(apiBase)) {
    issues.push(
      `API_PUBLIC_BASE_URL must be an absolute http(s) URL (got "${apiBase}") — every email ` +
        'loads the Nucleus logo from `${API_PUBLIC_BASE_URL}/brand/email-logo.png`.',
    );
  }

  // --- Auth secrets -------------------------------------------------------
  const secrets = new Map<string, string>();
  for (const key of SECRET_KEYS) {
    const value = read(key);
    if (value === '') {
      issues.push(`${key} must be set in production.`);
      continue;
    }
    if (value.length < MIN_SECRET_LENGTH) {
      issues.push(
        `${key} must be at least ${MIN_SECRET_LENGTH} characters (got ${value.length}). ` +
          'Generate one with `openssl rand -base64 48`.',
      );
    }
    secrets.set(key, value);
  }

  // Reusing a secret across audiences means a token minted for one audience
  // verifies for another — privilege escalation, not just hygiene. Keyed on the
  // secret VALUE so a duplicate is a map hit; the stored value is the first env
  // var that used it, which is what the message needs to name.
  const firstVarUsingSecret = new Map<string, string>();
  for (const [varName, secret] of secrets) {
    const firstVar = firstVarUsingSecret.get(secret);
    if (firstVar) {
      issues.push(
        `${varName} must differ from ${firstVar} — sharing a secret lets a token issued for ` +
          'one audience be accepted as another.',
      );
    } else {
      firstVarUsingSecret.set(secret, varName);
    }
  }

  // --- Object storage -----------------------------------------------------
  // Both keys empty = intentional: StorageService then omits `credentials` and
  // the SDK's default provider chain picks up the instance IAM role. Exactly one
  // set is always a misconfiguration, and it would only surface on the first
  // upload — a student photo failing to save weeks after the deploy.
  const s3AccessKey = read('S3_ACCESS_KEY');
  const s3SecretKey = read('S3_SECRET_KEY');
  if ((s3AccessKey === '') !== (s3SecretKey === '')) {
    const [set, empty] =
      s3AccessKey !== ''
        ? ['S3_ACCESS_KEY', 'S3_SECRET_KEY']
        : ['S3_SECRET_KEY', 'S3_ACCESS_KEY'];
    issues.push(
      `${set} is set but ${empty} is empty — set both for static credentials, ` +
        'or neither to use the instance IAM role.',
    );
  }
  if (KNOWN_DEV_CREDENTIALS.has(s3AccessKey)) {
    issues.push(
      'S3_ACCESS_KEY is still the MinIO dev default ("minioadmin") — set real credentials or ' +
        'leave both S3 keys empty to use the instance IAM role.',
    );
  }
  if (read('S3_BUCKET') === '') {
    issues.push(
      'S3_BUCKET must be set in production. Unset falls back to "nucleus", a name this ' +
        'account almost certainly does not own — S3 bucket names are globally unique.',
    );
  }
  // S3_ENDPOINT is the MinIO escape hatch. Pointed at a dev host in production it
  // would make every upload and presigned URL unreachable.
  const s3Endpoint = read('S3_ENDPOINT');
  if (/localhost|127\.0\.0\.1|minio/i.test(s3Endpoint)) {
    issues.push(
      `S3_ENDPOINT="${s3Endpoint}" looks like the dev MinIO instance. Leave it empty for ` +
        'real AWS S3 so the SDK derives the endpoint from S3_REGION.',
    );
  }
  // Path-style addressing is a MinIO requirement. Against real AWS it produces
  // legacy-style URLs that are being retired, and it breaks the one-origin-per-
  // bucket assumption the portals' CSP is built on.
  if (
    s3Endpoint === '' &&
    read('S3_FORCE_PATH_STYLE').toLowerCase() !== 'false'
  ) {
    issues.push(
      'S3_FORCE_PATH_STYLE must be "false" for real AWS S3 (it defaults to "true" for MinIO). ' +
        'Virtual-hosted style is what makes the bucket its own origin, which is what the ' +
        "portals' Content-Security-Policy allowlists.",
    );
  }

  // --- Datastore endpoints ------------------------------------------------
  // Both datastores are EXTERNAL in production (RDS and ElastiCache) — the
  // compose stack runs only this app. An unset host means the code default
  // `localhost`, i.e. the app container itself, where nothing is listening.
  if (read('POSTGRES_HOST') === '') {
    issues.push(
      'POSTGRES_HOST must be set in production (the external database endpoint). ' +
        'Unset means localhost — inside the app container, where nothing is listening.',
    );
  }
  if (read('REDIS_HOST') === '') {
    issues.push(
      'REDIS_HOST must be set in production (the external Redis endpoint). ' +
        'Unset means localhost — inside the app container, where nothing is listening.',
    );
  }
  // Note: neither PORT var is required. Unlike some sibling repos, this one's
  // code defaults are the correct standard ports (5432 / 6379), not dev ports.

  // --- Datastore credentials ---------------------------------------------
  if (KNOWN_DEV_CREDENTIALS.has(read('POSTGRES_PASSWORD'))) {
    issues.push(
      'POSTGRES_PASSWORD is still a dev default — set a real credential.',
    );
  }
  const redisPassword = read('REDIS_PASSWORD');
  // Managed Redis is often deployed with no AUTH token, protected instead by
  // in-transit encryption plus network isolation. That is acceptable — but only
  // when the traffic is actually encrypted; unauthenticated *and* plaintext
  // would put presigned-URL caches and Socket.IO fan-out on the wire.
  if (redisPassword === '' && read('REDIS_TLS').toLowerCase() !== 'true') {
    issues.push(
      'REDIS_PASSWORD must be set in production. Set an AUTH token, or if the instance has ' +
        'none, enable REDIS_TLS=true so the connection is at least encrypted.',
    );
  } else if (KNOWN_DEV_CREDENTIALS.has(redisPassword)) {
    issues.push('REDIS_PASSWORD is still a dev default — set a real credential.');
  }

  // --- Mail ---------------------------------------------------------------
  // Outside dev, MailService only delivers when a key is present; without one
  // every password-reset link and guardian OTP is merely logged, and no user can
  // ever complete a reset. Nothing else in the app reports this.
  if (read('SENDGRID_API_KEY') === '') {
    issues.push(
      'SENDGRID_API_KEY must be set in production — without it password-reset, ' +
        'temp-password and guardian-OTP emails are logged instead of delivered.',
    );
  } else if (read('MAIL_FROM') === '') {
    issues.push('MAIL_FROM must be set when SENDGRID_API_KEY is configured.');
  }

  return issues;
}

/**
 * Validates the environment and returns it unchanged. Passed to
 * `ConfigModule.forRoot({ validate })`, so throwing here aborts startup.
 */
export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = baseSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const nodeEnvRaw =
    typeof raw.NODE_ENV === 'string' ? raw.NODE_ENV.trim() : '';

  // An unrecognised NODE_ENV is fatal rather than silently treated as one
  // environment by some call sites and another by the rest.
  if (nodeEnvRaw !== '' && !isKnownNodeEnv(nodeEnvRaw)) {
    throw new Error(
      `Invalid environment configuration:\n  - NODE_ENV="${nodeEnvRaw}" is not recognised. ` +
        `Use one of: ${NODE_ENVS.join(', ')}. ` +
        '("prod" is NOT "production" — it would give you a locked-down CORS allowlist while ' +
        'pino still ran the dev pretty-printer.)',
    );
  }

  if (nodeEnvRaw === 'production') {
    const issues = productionIssues(raw);
    if (issues.length > 0) {
      throw new Error(
        `Refusing to start in production with an insecure configuration:\n` +
          issues.map((i) => `  - ${i}`).join('\n'),
      );
    }
  }

  const logger = new Logger('Env');

  // Warnings, not issues. Neither makes the deploy insecure, and failing here
  // would mean a rollback can't boot until someone edits platform config —
  // strictly worse than a log line.
  const dead = DEAD_KEYS.filter(
    (key) => typeof raw[key] === 'string' && raw[key].trim() !== '',
  );
  if (dead.length > 0) {
    logger.warn(
      `${dead.join(', ')} ${dead.length === 1 ? 'is' : 'are'} set but read by nothing in ` +
        'src/. Delete them so nobody edits a value expecting it to take effect.',
    );
  }

  if (
    nodeEnvRaw === 'production' &&
    (typeof raw.API_PUBLIC_BASE_URL !== 'string' ||
      raw.API_PUBLIC_BASE_URL.trim() === '')
  ) {
    logger.warn(
      'API_PUBLIC_BASE_URL is not set — emails will show a text header instead of the Nucleus ' +
        'logo. Set it to the public origin of this API (e.g. https://api-nucleus.raghuenggcollege.in).',
    );
  }

  if (nodeEnvRaw === 'production' && /^(true|1)$/i.test(String(raw.ALLOW_ADMIN_MIGRATIONS ?? '').trim())) {
    logger.warn(
      'ALLOW_ADMIN_MIGRATIONS is enabled in production — POST /admin/migrations/run can ' +
        'alter the schema from the admin UI. The compose stack already runs migrations in a ' +
        'one-shot `migrate` service; leave this off unless you are mid-incident.',
    );
  }

  return raw;
}
