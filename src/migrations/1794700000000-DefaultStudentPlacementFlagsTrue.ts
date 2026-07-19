import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Placement flags default to true. `allowed_by_dept_for_placements` and
 * `interested_in_placements_self` were added nullable with no default (NULL =
 * "not set"). The product intent is now that a student is assumed allowed by
 * department and interested in placements unless explicitly set otherwise:
 *   - SET DEFAULT true so new inserts (create + bulk-upload omit these columns)
 *     land as true.
 *   - Backfill existing NULL rows to true; rows explicitly set to true/false
 *     are left untouched.
 *
 * Columns stay nullable so an admin can still clear a value.
 */
export class DefaultStudentPlacementFlagsTrue1794700000000 implements MigrationInterface {
  name = 'DefaultStudentPlacementFlagsTrue1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students"
        ALTER COLUMN "allowed_by_dept_for_placements" SET DEFAULT true,
        ALTER COLUMN "interested_in_placements_self" SET DEFAULT true`,
    );

    await queryRunner.query(
      `UPDATE "students"
        SET "allowed_by_dept_for_placements" = true
        WHERE "allowed_by_dept_for_placements" IS NULL`,
    );

    await queryRunner.query(
      `UPDATE "students"
        SET "interested_in_placements_self" = true
        WHERE "interested_in_placements_self" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the defaults are reversible — the original NULLs backfilled in up()
    // are unrecoverable, so the UPDATEs are intentionally not undone.
    await queryRunner.query(
      `ALTER TABLE "students"
        ALTER COLUMN "allowed_by_dept_for_placements" DROP DEFAULT,
        ALTER COLUMN "interested_in_placements_self" DROP DEFAULT`,
    );
  }
}
