import { MigrationInterface, QueryRunner } from 'typeorm';

// Attendance groups move from the per-semester level up to the programme ×
// admission-year batch level: one set of groups is defined once per batch and
// carries across every semester. Swaps programme_semester_id for
// programme_id + admission_year_id, backfilling the new columns from the
// programme_semester each group used to belong to.
export class MoveAttendanceGroupsToProgrammeYear1779860000000 implements MigrationInterface {
  name = 'MoveAttendanceGroupsToProgrammeYear1779860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD "programme_id" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD "admission_year_id" integer`,
    );
    // Backfill the batch columns from each group's former programme_semester.
    await queryRunner.query(
      `UPDATE "attendance_groups" ag SET "programme_id" = ps."programme_id", "admission_year_id" = ps."admission_year_id" FROM "programme_semesters" ps WHERE ps."id" = ag."programme_semester_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ALTER COLUMN "programme_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ALTER COLUMN "admission_year_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP CONSTRAINT "FK_att_groups_programme_semester_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP CONSTRAINT "UQ_att_groups_ps_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_att_groups_programme_semester_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP COLUMN "programme_semester_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD CONSTRAINT "UQ_att_groups_prog_year_name" UNIQUE ("programme_id", "admission_year_id", "name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_groups_programme_id_admission_year_id" ON "attendance_groups" ("programme_id", "admission_year_id")`,
    );
    // Restrict on both parents so a programme or admission year still in use
    // by a group can't be removed out from under it.
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD CONSTRAINT "FK_att_groups_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD CONSTRAINT "FK_att_groups_admission_year_id" FOREIGN KEY ("admission_year_id") REFERENCES "admission_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP CONSTRAINT "FK_att_groups_admission_year_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP CONSTRAINT "FK_att_groups_programme_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_att_groups_programme_id_admission_year_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP CONSTRAINT "UQ_att_groups_prog_year_name"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD "programme_semester_id" integer`,
    );
    // Best-effort restore: point each group at the earliest programme_semester
    // of its batch. Batch-level name uniqueness keeps (ps, name) collision-free.
    await queryRunner.query(
      `UPDATE "attendance_groups" ag SET "programme_semester_id" = (SELECT ps."id" FROM "programme_semesters" ps WHERE ps."programme_id" = ag."programme_id" AND ps."admission_year_id" = ag."admission_year_id" ORDER BY ps."semester_id" ASC LIMIT 1)`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ALTER COLUMN "programme_semester_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP COLUMN "admission_year_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" DROP COLUMN "programme_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD CONSTRAINT "UQ_att_groups_ps_name" UNIQUE ("programme_semester_id", "name")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_groups_programme_semester_id" ON "attendance_groups" ("programme_semester_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_groups" ADD CONSTRAINT "FK_att_groups_programme_semester_id" FOREIGN KEY ("programme_semester_id") REFERENCES "programme_semesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
