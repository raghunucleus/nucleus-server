import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bootstrap master admin.
 *
 * Nothing else in the codebase can create one: `AdminUsersService.create()`
 * hard-codes `is_master_admin: false` and the flag is deliberately absent from
 * the input DTOs, so a fresh database has no way in until a master admin row
 * exists. This migration plants that first row.
 *
 * The password hash is a bcrypt digest (cost 12, matching `BCRYPT_ROUNDS` in
 * `admin.service.ts`) of the well-known bootstrap password `Admin@1234`.
 * It is intended to be changed immediately after the first sign-in — treat it
 * as a deployment credential, not a permanent one.
 *
 * Re-runnable: the insert is a no-op if an admin with this username or email
 * already exists, so it will not clobber a password that has since been
 * rotated, nor collide with `UQ_admins_username` / `UQ_admins_email`.
 */
export class SeedDefaultMasterAdmin1796800000000 implements MigrationInterface {
  name = 'SeedDefaultMasterAdmin1796800000000';

  private static readonly USERNAME = 'nucleusadmin';
  private static readonly EMAIL = 'softwaredevelopment@raghuenggcollege.in';
  private static readonly PASSWORD_HASH =
    '$2b$12$Ahrn7IFZ5snxfYXycGiqnOAPLQyvLEMFmYoDeO5MS0/WYl6.EaMQS';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "admins" ` +
        `("username", "email", "password_hash", "is_master_admin", "is_active", ` +
        `"first_name", "last_name", "display_name") ` +
        // The casts are load-bearing: $1 and $2 appear both here (where
        // Postgres would infer `text`) and in the NOT EXISTS comparison below
        // against varchar columns, and it refuses to deduce two types for one
        // parameter ("inconsistent types deduced for parameter $1").
        `SELECT $1::varchar, $2::varchar, $3::varchar, TRUE, TRUE, 'Nucleus', 'Admin', 'Nucleus Admin' ` +
        `WHERE NOT EXISTS (` +
        `SELECT 1 FROM "admins" WHERE "username" = $1 OR LOWER("email") = LOWER($2)` +
        `)`,
      [
        SeedDefaultMasterAdmin1796800000000.USERNAME,
        SeedDefaultMasterAdmin1796800000000.EMAIL,
        SeedDefaultMasterAdmin1796800000000.PASSWORD_HASH,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only remove the row if it is still the untouched bootstrap account —
    // a rotated password or a linked Google identity means it is in real use.
    await queryRunner.query(
      `DELETE FROM "admins" ` +
        `WHERE "username" = $1 AND LOWER("email") = LOWER($2) ` +
        `AND "password_hash" = $3 AND "google_id" IS NULL`,
      [
        SeedDefaultMasterAdmin1796800000000.USERNAME,
        SeedDefaultMasterAdmin1796800000000.EMAIL,
        SeedDefaultMasterAdmin1796800000000.PASSWORD_HASH,
      ],
    );
  }
}
