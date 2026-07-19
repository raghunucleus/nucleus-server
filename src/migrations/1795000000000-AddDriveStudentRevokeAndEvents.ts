import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Revoked lifecycle state + the per-student audit trail.
 *
 * - `revoked_at` / `revoked_by_employee_id` mirror the other `*_by` audit
 *   columns (no FK). The revoke REASON reuses `rejection_reason` — a row is
 *   either denied by the student or revoked by an employee, never both.
 * - `drive_student_events` is an append-only log: one row per status change /
 *   action per drive-student, powering the track view. Modelled on
 *   `company_activity_log`; `actor_employee_id` is nullable because students act
 *   too (accept/deny).
 */
export class AddDriveStudentRevokeAndEvents1795000000000 implements MigrationInterface {
  name = 'AddDriveStudentRevokeAndEvents1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "drive_students" ` +
        `ADD "revoked_at" TIMESTAMP, ` +
        `ADD "revoked_by_employee_id" integer`,
    );

    await queryRunner.query(
      `CREATE TABLE "drive_student_events" (` +
        `"id" SERIAL NOT NULL, ` +
        `"drive_student_id" integer NOT NULL, ` +
        `"action" character varying(24) NOT NULL, ` +
        `"from_status" smallint, ` +
        `"to_status" smallint NOT NULL, ` +
        `"actor_type" character varying(12) NOT NULL, ` +
        `"actor_employee_id" integer, ` +
        `"reason" character varying(512), ` +
        `"created_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_drive_student_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_student_events_drive_student_id" ` +
        `ON "drive_student_events" ("drive_student_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_student_events" ADD CONSTRAINT "FK_drive_student_events_drive_student_id" ` +
        `FOREIGN KEY ("drive_student_id") REFERENCES "drive_students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "drive_student_events"`);
    await queryRunner.query(
      `ALTER TABLE "drive_students" ` +
        `DROP COLUMN IF EXISTS "revoked_by_employee_id", ` +
        `DROP COLUMN IF EXISTS "revoked_at"`,
    );
  }
}
