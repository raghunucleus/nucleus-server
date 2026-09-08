import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import type { TlsOptions } from 'node:tls';

/**
 * TLS options for the two datastore connections.
 *
 * Postgres and Redis are EXTERNAL in production (RDS and ElastiCache) — the
 * traffic leaves the app host, so it has to be encrypted. RDS Postgres 16+ ships
 * `rds.force_ssl=1` in its default parameter group and ElastiCache with
 * encryption-in-transit only speaks TLS, so without these flags the app cannot
 * connect at all.
 *
 * Both default to OFF: local dev talks to the plaintext containers under
 * `docker/postgres` and `docker/redis` and must keep booting unchanged.
 *
 * These read `process.env` directly rather than `ConfigService` so that
 * `src/data-source.ts` — the TypeORM CLI datasource used by the `migrate`
 * service and `npm run migration:*`, which runs outside the Nest container —
 * shares one implementation with `app.module.ts`. `ConfigModule` is configured
 * with no `load:` factories, so it reads the same `process.env` anyway.
 */

/** `true` (case/whitespace-insensitive) enables the flag; anything else is off. */
function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/**
 * `ssl` for the TypeORM postgres driver.
 *
 * - `POSTGRES_SSL` unset/false → `undefined`, i.e. the option is not set at all
 *   and the driver connects in plaintext (the dev default).
 * - with `POSTGRES_SSL_CA_FILE` → verify the server certificate against that
 *   PEM (for RDS: the global bundle from
 *   https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem).
 * - without one → encrypted but UNVERIFIED, which is warned about loudly.
 */
export function postgresSslOptions(): TlsOptions | undefined {
  if (!isEnabled(process.env.POSTGRES_SSL)) return undefined;

  const caFile = process.env.POSTGRES_SSL_CA_FILE?.trim();
  if (caFile) {
    // Throwing beats a silent downgrade to rejectUnauthorized:false — an
    // operator who named a CA file meant for it to be enforced.
    let ca: string;
    try {
      ca = readFileSync(caFile, 'utf8');
    } catch (err) {
      throw new Error(
        `POSTGRES_SSL_CA_FILE="${caFile}" could not be read (${
          err instanceof Error ? err.message : String(err)
        }). Mount the CA bundle into the container or unset the variable.`,
      );
    }
    return { ca, rejectUnauthorized: true };
  }

  new Logger('Datastore').warn(
    'POSTGRES_SSL=true without POSTGRES_SSL_CA_FILE — the connection is encrypted but the ' +
      'server certificate is NOT verified. Set POSTGRES_SSL_CA_FILE to the RDS global bundle ' +
      '(https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem) to close the MITM gap.',
  );
  return { rejectUnauthorized: false };
}

/**
 * `tls` for the ioredis client, or `undefined` for a plaintext connection.
 *
 * ElastiCache presents an Amazon-root certificate that is already in Node's
 * trust store, so no CA plumbing is needed — but the SNI servername must be the
 * configured host or verification fails.
 *
 * `RedisIoAdapter` builds its pub/sub pair with `.duplicate()`, which copies
 * these options, so the Socket.IO fan-out is covered by the same flag.
 */
export function redisTlsOptions(): { servername: string } | undefined {
  if (!isEnabled(process.env.REDIS_TLS)) return undefined;
  return { servername: process.env.REDIS_HOST?.trim() || 'localhost' };
}
