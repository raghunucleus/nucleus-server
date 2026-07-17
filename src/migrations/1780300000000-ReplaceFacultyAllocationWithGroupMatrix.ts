import { MigrationInterface, QueryRunner } from 'typeorm';

// Replaces the flat per-subject faculty roster with a (subject × group)
// matrix. One teacher per cell now lives in
// `programme_semester_subject_group_faculty`; the old flat table is dropped.
//
// Existing rows in the old table are not preserved — this is a
// pre-production schema and a clean reset is the cheapest path. The new
// matrix table is repopulated from the redesigned screen.
//
// The elective candidate-faculty table (`programme_semester_subject_option_faculty`)
// is untouched: slot-enrollments still depends on it. It will fold into the
// student-allocation flow in a later change.
export class ReplaceFacultyAllocationWithGroupMatrix1780300000000 implements MigrationInterface {
  name = 'ReplaceFacultyAllocationWithGroupMatrix1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_faculty" DROP CONSTRAINT "FK_pss_faculty_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_faculty" DROP CONSTRAINT "FK_pss_faculty_entry_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pss_faculty_employee_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_pss_faculty_entry_id"`);
    await queryRunner.query(`DROP TABLE "programme_semester_subject_faculty"`);

    await queryRunner.query(
      `CREATE TABLE "programme_semester_subject_group_faculty" ("id" SERIAL NOT NULL, "programme_semester_subject_id" integer NOT NULL, "attendance_group_id" integer NOT NULL, "employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_pssgf_subject_group" UNIQUE ("programme_semester_subject_id", "attendance_group_id"), CONSTRAINT "PK_pssgf_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pssgf_programme_semester_subject_id" ON "programme_semester_subject_group_faculty" ("programme_semester_subject_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pssgf_attendance_group_id" ON "programme_semester_subject_group_faculty" ("attendance_group_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pssgf_employee_id" ON "programme_semester_subject_group_faculty" ("employee_id")`,
    );
    // Cascade on the parent entry and the attendance group so removing
    // either cleans up cells naturally. Restrict on employee so an
    // allocated faculty can't be hard-deleted (only deactivated).
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_group_faculty" ADD CONSTRAINT "FK_pssgf_programme_semester_subject_id" FOREIGN KEY ("programme_semester_subject_id") REFERENCES "programme_semester_subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_group_faculty" ADD CONSTRAINT "FK_pssgf_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_group_faculty" ADD CONSTRAINT "FK_pssgf_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_group_faculty" DROP CONSTRAINT "FK_pssgf_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_group_faculty" DROP CONSTRAINT "FK_pssgf_attendance_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_group_faculty" DROP CONSTRAINT "FK_pssgf_programme_semester_subject_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_pssgf_employee_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pssgf_attendance_group_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pssgf_programme_semester_subject_id"`,
    );
    await queryRunner.query(
      `DROP TABLE "programme_semester_subject_group_faculty"`,
    );

    await queryRunner.query(
      `CREATE TABLE "programme_semester_subject_faculty" ("id" SERIAL NOT NULL, "programme_semester_subject_id" integer NOT NULL, "employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_pss_faculty_entry_employee" UNIQUE ("programme_semester_subject_id", "employee_id"), CONSTRAINT "PK_pss_faculty_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pss_faculty_entry_id" ON "programme_semester_subject_faculty" ("programme_semester_subject_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pss_faculty_employee_id" ON "programme_semester_subject_faculty" ("employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_faculty" ADD CONSTRAINT "FK_pss_faculty_entry_id" FOREIGN KEY ("programme_semester_subject_id") REFERENCES "programme_semester_subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_faculty" ADD CONSTRAINT "FK_pss_faculty_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }
}
