import { MigrationInterface, QueryRunner } from 'typeorm';

// One-time passwords for verifying a student's PERSONAL email address
// (the OTP_VERIFY edit policy — verification IS the approval gate; no
// approver involved). Mirrors `guardian_otps`: SHA-256 of the 6-digit code
// only, single-use, short-lived, attempt-capped; per-student/per-target
// request rate limits live in Redis. `email` is the NEW address the code was
// sent to — promotion writes it to `students.personal_email` only after a
// successful verify.
export class CreateStudentEmailOtps1793200000000 implements MigrationInterface {
  name = 'CreateStudentEmailOtps1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "student_email_otps" (
        "id" SERIAL NOT NULL,
        "student_id" integer NOT NULL,
        "email" character varying(255) NOT NULL,
        "otp_hash" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "consumed_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_student_email_otps_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_student_email_otps_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_email_otps_student_id" ON "student_email_otps" ("student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_student_email_otps_expires_at" ON "student_email_otps" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "student_email_otps"`);
  }
}
