import { MigrationInterface, QueryRunner } from 'typeorm';

// Academic holidays move from a single programme (programme_id FK) to many
// programmes via a join table. A programme-scoped holiday can now name several
// programmes in one declaration. The old programme_id column is dropped (no
// programme-scoped holidays existed) and the scope CHECK is rewritten to no
// longer reference it — "programme has at least one programme" is enforced at
// the service/DTO layer, since a CHECK can't reach into the join table.
export class AcademicHolidayMultiProgramme1781100000000 implements MigrationInterface {
  name = 'AcademicHolidayMultiProgramme1781100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Tear down the single-programme column and everything pinned to it.
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "CHK_academic_holidays_scope_fks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "FK_academic_holidays_programme_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_academic_holidays_programme_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP COLUMN "programme_id"`,
    );

    // Join table: one row per (holiday, programme). Both FKs cascade-delete so
    // removing a holiday or a programme cleans up the links automatically.
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

    // Scope CHECK without programme_id. Programme membership lives in the join
    // table now; the institution/group invariants are unchanged.
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "CHK_academic_holidays_scope_fks" CHECK ((scope = 'institution' AND attendance_group_id IS NULL) OR (scope = 'programme' AND attendance_group_id IS NULL) OR (scope = 'group' AND attendance_group_id IS NOT NULL))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "CHK_academic_holidays_scope_fks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holiday_programmes" DROP CONSTRAINT "FK_ahp_programme_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holiday_programmes" DROP CONSTRAINT "FK_ahp_holiday_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_academic_holiday_programmes_programme_id"`,
    );
    await queryRunner.query(`DROP TABLE "academic_holiday_programmes"`);

    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD "programme_id" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_academic_holidays_programme_id" ON "academic_holidays" ("programme_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "FK_academic_holidays_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "CHK_academic_holidays_scope_fks" CHECK ((scope = 'institution' AND programme_id IS NULL AND attendance_group_id IS NULL) OR (scope = 'programme' AND programme_id IS NOT NULL AND attendance_group_id IS NULL) OR (scope = 'group' AND attendance_group_id IS NOT NULL))`,
    );
  }
}
