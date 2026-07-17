import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStudentExamResultStaging1781500000000 implements MigrationInterface {
  name = 'CreateStudentExamResultStaging1781500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Transient scratch space for a single chunked upload session. Rows are
    // validated + parsed as they arrive, then swapped into the real result
    // tables atomically on commit and deleted. No FK to students — the resolved
    // student_id is nullable (null for an unmatched HT No flagged as an error).
    await queryRunner.query(
      `CREATE TABLE "student_exam_result_staging" ("id" SERIAL NOT NULL, "upload_session" uuid NOT NULL, "employee_id" integer NOT NULL, "programme_admission_year_id" integer NOT NULL, "row_index" integer NOT NULL, "examination" character varying(64) NOT NULL, "exam_date" date, "roll_number" character varying(32) NOT NULL, "subject_code" character varying(32) NOT NULL, "subject_name" character varying(128) NOT NULL, "credits" numeric(5,1), "grade" character varying(8) NOT NULL, "grade_points" numeric(4,1), "semester" smallint, "exam_type" character varying(16), "student_id" integer, "error_column" character varying(32), "error_reason" character varying(160), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_student_exam_result_staging_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_exam_result_staging_session" ON "student_exam_result_staging" ("upload_session")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_exam_result_staging_session_subject" ON "student_exam_result_staging" ("upload_session", "student_id", "semester", "subject_code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_exam_result_staging_pay" ON "student_exam_result_staging" ("programme_admission_year_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_exam_result_staging_employee" ON "student_exam_result_staging" ("employee_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_exam_result_staging_employee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_exam_result_staging_pay"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_exam_result_staging_session_subject"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_student_exam_result_staging_session"`,
    );
    await queryRunner.query(`DROP TABLE "student_exam_result_staging"`);
  }
}
