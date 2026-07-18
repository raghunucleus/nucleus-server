import { MigrationInterface, QueryRunner } from 'typeorm';

// The student query engine's placement/internship filters probe
// drive_students with a correlated EXISTS on (student_id, status = 60) —
// once per candidate student row. Widen the student_id index to a
// (student_id, status) composite so the probe resolves in the index; the
// leading column still serves every plain student_id lookup, so the old
// single-column index is redundant and dropped.
export class CompositeDriveStudentsStudentIdStatusIndex1795300000000 implements MigrationInterface {
  name = 'CompositeDriveStudentsStudentIdStatusIndex1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_drive_students_student_id_status" ON "drive_students" ("student_id", "status")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_drive_students_student_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_drive_students_student_id" ON "drive_students" ("student_id")`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_drive_students_student_id_status"`,
    );
  }
}
