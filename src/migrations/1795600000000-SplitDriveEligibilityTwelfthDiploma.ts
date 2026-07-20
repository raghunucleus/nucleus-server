import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits the combined `min_twelfth_or_diploma_percentage` eligibility threshold
 * into two independent ones — `min_twelfth_percentage` and
 * `min_diploma_percentage` — so a drive can demand, say, 70% in 12th and 80%
 * in diploma. Students carry the two percentages in separate columns already
 * (regular entrants have a 12th, lateral entrants a diploma), so the criteria
 * side now mirrors storage and is matched per entry type.
 *
 * Existing rows are backfilled with the old value in BOTH columns, which
 * reproduces today's behaviour exactly (one threshold applied to whichever
 * percentage the student has).
 */
export class SplitDriveEligibilityTwelfthDiploma1795600000000
  implements MigrationInterface
{
  name = 'SplitDriveEligibilityTwelfthDiploma1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drive_eligibility" ADD COLUMN "min_twelfth_percentage" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_eligibility" ADD COLUMN "min_diploma_percentage" numeric(5,2)`,
    );
    await queryRunner.query(
      `UPDATE "drive_eligibility" SET ` +
        `"min_twelfth_percentage" = "min_twelfth_or_diploma_percentage", ` +
        `"min_diploma_percentage" = "min_twelfth_or_diploma_percentage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_eligibility" DROP COLUMN "min_twelfth_or_diploma_percentage"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drive_eligibility" ADD COLUMN "min_twelfth_or_diploma_percentage" numeric(5,2)`,
    );
    await queryRunner.query(
      `UPDATE "drive_eligibility" SET "min_twelfth_or_diploma_percentage" = ` +
        `COALESCE("min_twelfth_percentage", "min_diploma_percentage")`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_eligibility" DROP COLUMN IF EXISTS "min_diploma_percentage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_eligibility" DROP COLUMN IF EXISTS "min_twelfth_percentage"`,
    );
  }
}
