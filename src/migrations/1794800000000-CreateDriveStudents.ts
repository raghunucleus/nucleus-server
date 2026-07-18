import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The drive's persisted shortlist — students imported into a drive from the
 * Filter tab. One row per (drive, student); the unique constraint enforces
 * "imported once".
 *
 * Both FKs CASCADE: the membership is a part of the drive and follows the
 * student, so deleting either parent clears the row. `imported_by_employee_id`
 * has no FK (audit-only, like `created_by_employee_id` on `drives`).
 */
export class CreateDriveStudents1794800000000 implements MigrationInterface {
  name = 'CreateDriveStudents1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "drive_students" (` +
        `"id" SERIAL NOT NULL, ` +
        `"drive_id" integer NOT NULL, ` +
        `"student_id" integer NOT NULL, ` +
        `"imported_by_employee_id" integer, ` +
        `"imported_at" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "UQ_drive_students_drive_id_student_id" UNIQUE ("drive_id", "student_id"), ` +
        `CONSTRAINT "PK_drive_students" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_drive_students_student_id" ON "drive_students" ("student_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" ADD CONSTRAINT "FK_drive_students_drive_id" ` +
        `FOREIGN KEY ("drive_id") REFERENCES "drives"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "drive_students" ADD CONSTRAINT "FK_drive_students_student_id" ` +
        `FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "drive_students"`);
  }
}
