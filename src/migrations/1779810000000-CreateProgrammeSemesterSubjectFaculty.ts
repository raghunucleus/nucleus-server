import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProgrammeSemesterSubjectFaculty1779810000000 implements MigrationInterface {
  name = 'CreateProgrammeSemesterSubjectFaculty1779810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "programme_semester_subject_faculty" ("id" SERIAL NOT NULL, "programme_semester_subject_id" integer NOT NULL, "employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_pss_faculty_entry_employee" UNIQUE ("programme_semester_subject_id", "employee_id"), CONSTRAINT "PK_pss_faculty_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pss_faculty_entry_id" ON "programme_semester_subject_faculty" ("programme_semester_subject_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pss_faculty_employee_id" ON "programme_semester_subject_faculty" ("employee_id")`,
    );
    // Cascade on the parent entry so removing the subject cleans up its
    // faculty links. Restrict on employee so an allocated faculty can't be
    // hard-deleted (they can still be deactivated).
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_faculty" ADD CONSTRAINT "FK_pss_faculty_entry_id" FOREIGN KEY ("programme_semester_subject_id") REFERENCES "programme_semester_subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subject_faculty" ADD CONSTRAINT "FK_pss_faculty_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
  }
}
