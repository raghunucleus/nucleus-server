import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login sessions for students, employees and parents, replacing the Redis
 * refresh-token families (`<type>:rt:<subject>:<fid>`). One row per signed-in
 * device; its uuid is the `sid` claim in both JWTs. This is what the device
 * limit (default 2) counts, what "My devices" lists and what an admin can
 * force-sign-out. See `AuthSession` / `AuthSessionsService`.
 *
 * Polymorphic on `audience` + `subject_id` (like `account_invites`), so no FK:
 * `subject_id` is `students.id`, `employees.id` or `guardian_credentials.id`.
 *
 * `UQ_auth_sessions_audience_subject_id_device_id` is a PARTIAL unique index
 * (live rows that carry a device id) — Postgres has no partial UNIQUE
 * constraint, so it exists only here, not as an entity decorator. It backs
 * same-device replacement: a re-login from the same browser/phone supersedes
 * its live row instead of taking a second slot.
 *
 * Also adds `employees.device_limit`: a per-employee override of the default
 * (NULL = default). Lowering it never evicts anyone; it applies at the next
 * login.
 *
 * Deploying this signs everyone out once: existing tokens carry no `sid` and
 * are rejected, and the old Redis family keys simply expire.
 */
export class CreateAuthSessions1797300000000 implements MigrationInterface {
  name = 'CreateAuthSessions1797300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "auth_sessions" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"audience" character varying(16) NOT NULL, ` +
        `"subject_id" integer NOT NULL, ` +
        `"device_id" character varying(64), ` +
        `"device_name" character varying(128) NOT NULL DEFAULT 'Unknown device', ` +
        `"ip" character varying(64), ` +
        `"user_agent" character varying(512), ` +
        `"refresh_jti" character varying(64), ` +
        `"prev_refresh_jti" character varying(64), ` +
        `"rotated_at" TIMESTAMP WITH TIME ZONE, ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"last_used_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, ` +
        `"revoked_at" TIMESTAMP WITH TIME ZONE, ` +
        `"revoked_reason" character varying(32), ` +
        `CONSTRAINT "CHK_auth_sessions_audience" CHECK ("audience" IN ('student', 'employee', 'guardian')), ` +
        `CONSTRAINT "PK_auth_sessions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_sessions_audience_subject_id" ON "auth_sessions" ("audience", "subject_id") WHERE "revoked_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_auth_sessions_audience_subject_id_device_id" ON "auth_sessions" ("audience", "subject_id", "device_id") WHERE "revoked_at" IS NULL AND "device_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_auth_sessions_expires_at" ON "auth_sessions" ("expires_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "employees" ADD "device_limit" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "CHK_employees_device_limit" CHECK ("device_limit" IS NULL OR ("device_limit" >= 1 AND "device_limit" <= 20))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT "CHK_employees_device_limit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" DROP COLUMN "device_limit"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_auth_sessions_expires_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_auth_sessions_audience_subject_id_device_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_auth_sessions_audience_subject_id"`,
    );
    await queryRunner.query(`DROP TABLE "auth_sessions"`);
  }
}
