import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The drive-student lifecycle: numeric statuses with a gap of 10 so states can
 * be inserted later without renumbering (a deliberate, user-confirmed deviation
 * from the repo's string-status convention — see drive-student-status.ts).
 *
 *   10 Imported → 20 Invited → { 30 Accepted | 40 Denied (reason required) }
 *   30 → { 50 Not Attended | 60 Selected | 70 Not Selected }
 *
 * The two `*_by_employee_id` columns are audit-only (no FK), matching
 * `imported_by_employee_id`. The (drive_id, status) index serves the employee
 * status-filtered roster and invite-all's "all status-10 rows" scan.
 */
export class AddDriveStudentLifecycle1794900000000 implements MigrationInterface {
  name = 'AddDriveStudentLifecycle1794900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drive_students" ` +
        `ADD "status" smallint NOT NULL DEFAULT 10, ` +
        `ADD "invited_at" TIMESTAMP, ` +
        `ADD "invited_by_employee_id" integer, ` +
        `ADD "responded_at" TIMESTAMP, ` +
        `ADD "rejection_reason" character varying(512), ` +
        `ADD "outcome_marked_at" TIMESTAMP, ` +
        `ADD "outcome_marked_by_employee_id" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_students_drive_id_status" ` +
        `ON "drive_students" ("drive_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_drive_students_drive_id_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" ` +
        `DROP COLUMN IF EXISTS "outcome_marked_by_employee_id", ` +
        `DROP COLUMN IF EXISTS "outcome_marked_at", ` +
        `DROP COLUMN IF EXISTS "rejection_reason", ` +
        `DROP COLUMN IF EXISTS "responded_at", ` +
        `DROP COLUMN IF EXISTS "invited_by_employee_id", ` +
        `DROP COLUMN IF EXISTS "invited_at", ` +
        `DROP COLUMN IF EXISTS "status"`,
    );
  }
}
