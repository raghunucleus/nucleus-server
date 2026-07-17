import { MigrationInterface, QueryRunner } from 'typeorm';

// Attendance groups gain a `code` (short identifier shown alongside name,
// unique within a programme × admission-year batch) and an `is_active` flag.
// Groups can no longer be hard-deleted — deactivation replaces removal so
// historical membership and timetable links survive.
export class AddCodeAndIsActiveToAttendanceGroups1779890000000 implements MigrationInterface {
  name = 'AddCodeAndIsActiveToAttendanceGroups1779890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add nullable first so existing rows survive the alter, backfill from
    // id (guaranteed unique inside any batch), then enforce NOT NULL.
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD "code" character varying(32)`,
    );
    await queryRunner.query(
      `UPDATE "attendance_groups" SET "code" = 'G' || "id"::text WHERE "code" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ALTER COLUMN "code" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD CONSTRAINT "UQ_att_groups_prog_year_code" UNIQUE ("programme_id", "admission_year_id", "code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP CONSTRAINT "UQ_att_groups_prog_year_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP COLUMN "is_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP COLUMN "code"`,
    );
  }
}
