import { MigrationInterface, QueryRunner } from 'typeorm';

// Holidays are now always institution-wide. The whole scope concept — the
// programme join table, the attendance_group link, and the `scope` column with
// its CHECK — is removed. Every declared holiday applies to the entire
// institution; there is no per-programme or per-group narrowing anymore.
export class RemoveHolidayScope1781200000000 implements MigrationInterface {
  name = 'RemoveHolidayScope1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "academic_holiday_programmes"`);
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "CHK_academic_holidays_scope_fks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "FK_academic_holidays_attendance_group_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_academic_holidays_attendance_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP COLUMN "attendance_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP COLUMN "scope"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD "scope" character varying(16) NOT NULL DEFAULT 'institution'`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD "attendance_group_id" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_academic_holidays_attendance_group_id" ON "academic_holidays" ("attendance_group_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "FK_academic_holidays_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE TABLE "academic_holiday_programmes" ("holiday_id" integer NOT NULL, "programme_id" integer NOT NULL, CONSTRAINT "PK_academic_holiday_programmes" PRIMARY KEY ("holiday_id", "programme_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_academic_holiday_programmes_programme_id" ON "academic_holiday_programmes" ("programme_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holiday_programmes" ADD CONSTRAINT "FK_ahp_holiday_id" FOREIGN KEY ("holiday_id") REFERENCES "academic_holidays"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holiday_programmes" ADD CONSTRAINT "FK_ahp_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "CHK_academic_holidays_scope_fks" CHECK ((scope = 'institution' AND attendance_group_id IS NULL) OR (scope = 'programme' AND attendance_group_id IS NULL) OR (scope = 'group' AND attendance_group_id IS NOT NULL))`,
    );
  }
}
