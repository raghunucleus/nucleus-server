import { MigrationInterface, QueryRunner } from 'typeorm';

// A student's earned industry certifications (repeatable group on the profile).
// Rows are created when an approver approves a `profile_update` request's
// certification item (student path) or directly by an admin. The supporting
// certificate file is mandatory — an entry cannot be requested without it —
// and lives in private object storage under `certificate_file_key`.
export class CreateStudentIndustryCertifications1793100000000 implements MigrationInterface {
  name = 'CreateStudentIndustryCertifications1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "student_industry_certifications" (
        "id" SERIAL NOT NULL,
        "student_id" integer NOT NULL,
        "industry_certification_id" integer NOT NULL,
        "certificate_file_key" text NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_student_industry_certifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_student_industry_certifications_student_id_certification_id" UNIQUE ("student_id", "industry_certification_id"),
        CONSTRAINT "FK_student_industry_certifications_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_student_industry_certifications_industry_certification_id" FOREIGN KEY ("industry_certification_id") REFERENCES "industry_certifications"("id") ON DELETE RESTRICT
      )`,
    );
    // No IDX on student_id: the composite UNIQUE leads with student_id and
    // serves prefix lookups (same reasoning as states/districts).
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "student_industry_certifications"`);
  }
}
