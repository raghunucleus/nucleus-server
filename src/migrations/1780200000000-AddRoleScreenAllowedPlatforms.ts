import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `allowed_platforms` to `role_screens` so a role can grant a screen on
 * a subset of the catalog screen's platforms (e.g. include the screen on web
 * but not mobile, or vice versa). Existing rows are backfilled to
 * `["web","mobile"]` — the most permissive default — because before this
 * column existed, a role implicitly granted every platform the catalog
 * screen declared. The runtime intersects this with the catalog so the
 * default is equivalent to the previous behaviour.
 */
export class AddRoleScreenAllowedPlatforms1780200000000 implements MigrationInterface {
  name = 'AddRoleScreenAllowedPlatforms1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role_screens" ADD "allowed_platforms" jsonb NOT NULL DEFAULT '["web","mobile"]'::jsonb`,
    );
    // Drop the default — application code is the source of truth from here on.
    await queryRunner.query(
      `ALTER TABLE "role_screens" ALTER COLUMN "allowed_platforms" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role_screens" DROP COLUMN "allowed_platforms"`,
    );
  }
}
