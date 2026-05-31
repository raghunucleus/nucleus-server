import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStudentExamResults1781400000000
  implements MigrationInterface
{
  name = 'CreateStudentExamResults1781400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Full attempt history — every uploaded grade-sheet row.
    await queryRunner.query(
      `CREATE TABLE "student_exam_results" ("id" SERIAL NOT NULL, "programme_admission_year_id" integer NOT NULL, "student_id" integer NOT NULL, "semester" smallint NOT NULL, "exam_type" character varying(16) NOT NULL, "exam_date" date NOT NULL, "subject_code" character varying(32) NOT NULL, "subject_name" character varying(128) NOT NULL, "credits" numeric(5,1) NOT NULL, "grade" character varying(2) NOT NULL, "grade_points" numeric(4,1) NOT NULL, "is_best" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_student_exam_results_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_exam_results_programme_admission_year_id" ON "student_exam_results" ("programme_admission_year_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_exam_results_student_id_semester" ON "student_exam_results" ("student_id", "semester")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_exam_results_student_subject" ON "student_exam_results" ("student_id", "semester", "subject_code")`,
    );

    // Cached SGPA + per-semester aggregates.
    await queryRunner.query(
      `CREATE TABLE "student_semester_gpa" ("id" SERIAL NOT NULL, "programme_admission_year_id" integer NOT NULL, "student_id" integer NOT NULL, "semester" smallint NOT NULL, "sgpa" numeric(5,2) NOT NULL, "total_credits" numeric(6,1) NOT NULL, "credit_points" numeric(8,1) NOT NULL, "subjects_count" integer NOT NULL, "passed_count" integer NOT NULL, "backlog_count" integer NOT NULL, "computed_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_student_semester_gpa_student_id_semester" UNIQUE ("student_id", "semester"), CONSTRAINT "PK_student_semester_gpa_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_semester_gpa_programme_admission_year_id" ON "student_semester_gpa" ("programme_admission_year_id")`,
    );

    // Cached CGPA + per-student aggregates.
    await queryRunner.query(
      `CREATE TABLE "student_cgpa" ("id" SERIAL NOT NULL, "programme_admission_year_id" integer NOT NULL, "student_id" integer NOT NULL, "cgpa" numeric(5,2) NOT NULL, "total_credits" numeric(7,1) NOT NULL, "credit_points" numeric(9,1) NOT NULL, "semesters_count" integer NOT NULL, "subjects_count" integer NOT NULL, "passed_count" integer NOT NULL, "backlog_count" integer NOT NULL, "computed_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_student_cgpa_student_id" UNIQUE ("student_id"), CONSTRAINT "PK_student_cgpa_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_cgpa_programme_admission_year_id" ON "student_cgpa" ("programme_admission_year_id")`,
    );

    // Foreign keys — batch + student, cascading so a removed batch/student
    // takes its results and cached GPAs with it.
    await queryRunner.query(
      `ALTER TABLE "student_exam_results" ADD CONSTRAINT "FK_student_exam_results_programme_admission_year_id" FOREIGN KEY ("programme_admission_year_id") REFERENCES "programme_admission_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_exam_results" ADD CONSTRAINT "FK_student_exam_results_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_semester_gpa" ADD CONSTRAINT "FK_student_semester_gpa_programme_admission_year_id" FOREIGN KEY ("programme_admission_year_id") REFERENCES "programme_admission_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_semester_gpa" ADD CONSTRAINT "FK_student_semester_gpa_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_cgpa" ADD CONSTRAINT "FK_student_cgpa_programme_admission_year_id" FOREIGN KEY ("programme_admission_year_id") REFERENCES "programme_admission_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_cgpa" ADD CONSTRAINT "FK_student_cgpa_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_cgpa" DROP CONSTRAINT "FK_student_cgpa_student_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_cgpa" DROP CONSTRAINT "FK_student_cgpa_programme_admission_year_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_semester_gpa" DROP CONSTRAINT "FK_student_semester_gpa_student_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_semester_gpa" DROP CONSTRAINT "FK_student_semester_gpa_programme_admission_year_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_exam_results" DROP CONSTRAINT "FK_student_exam_results_student_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_exam_results" DROP CONSTRAINT "FK_student_exam_results_programme_admission_year_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_cgpa_programme_admission_year_id"`,
    );
    await queryRunner.query(`DROP TABLE "student_cgpa"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_semester_gpa_programme_admission_year_id"`,
    );
    await queryRunner.query(`DROP TABLE "student_semester_gpa"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_exam_results_student_subject"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_exam_results_student_id_semester"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_exam_results_programme_admission_year_id"`,
    );
    await queryRunner.query(`DROP TABLE "student_exam_results"`);
  }
}
