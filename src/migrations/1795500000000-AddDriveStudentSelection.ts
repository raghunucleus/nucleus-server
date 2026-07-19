import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Selection details captured when a drive student is marked Selected (60):
 * the designation (drive profile) they were picked for and the recorded
 * package. `ctc`/`stipend` hold the fixed value or the range MAX — the only
 * columns student filters read; the `_min` columns hold a range's lower bound
 * (NULL for a single amount, so "range" = `_min IS NOT NULL`). A dual-flag
 * offer type (internship + full-time) records both amounts.
 *
 * The profile FK is SET NULL because editing a drive deletes omitted
 * profiles — the recorded amounts must survive that; only the link is lost.
 * Rows Selected before this feature keep all five columns NULL (no backfill).
 */
export class AddDriveStudentSelection1795500000000 implements MigrationInterface {
  name = 'AddDriveStudentSelection1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drive_students" ADD "selected_drive_profile_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" ADD "ctc" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" ADD "ctc_min" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" ADD "stipend" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" ADD "stipend_min" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" ADD CONSTRAINT "FK_drive_students_selected_drive_profile_id" ` +
        `FOREIGN KEY ("selected_drive_profile_id") REFERENCES "drive_profiles"("id") ` +
        `ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_students_selected_drive_profile_id" ` +
        `ON "drive_students" ("selected_drive_profile_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_drive_students_selected_drive_profile_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" DROP CONSTRAINT "FK_drive_students_selected_drive_profile_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" DROP COLUMN "stipend_min"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" DROP COLUMN "stipend"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" DROP COLUMN "ctc_min"`,
    );
    await queryRunner.query(`ALTER TABLE "drive_students" DROP COLUMN "ctc"`);
    await queryRunner.query(
      `ALTER TABLE "drive_students" DROP COLUMN "selected_drive_profile_id"`,
    );
  }
}
