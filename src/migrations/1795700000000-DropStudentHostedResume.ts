import { MigrationInterface, QueryRunner } from 'typeorm';

// Resumes are now ONE externally-hosted link the student supplies
// (`resume_external_url`, kept). We no longer host resume files, so the hosted
// half goes: the S3 object key, its upload timestamp, the permanent share token
// behind `GET /public/resumes/<token>` (route deleted), and the download
// counters that only ever measured that route.
//
// The bucket objects under `resumes/` were deleted by a one-off script before
// this ran (they were keyed by `resume_key`, which this drops). Nothing writes
// that prefix any more, so no cleanup step is left to repeat.
export class DropStudentHostedResume1795700000000 implements MigrationInterface {
  name = 'DropStudentHostedResume1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "UQ_students_resume_public_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students"
        DROP COLUMN IF EXISTS "resume_key",
        DROP COLUMN IF EXISTS "resume_uploaded_at",
        DROP COLUMN IF EXISTS "resume_public_token",
        DROP COLUMN IF EXISTS "resume_download_count",
        DROP COLUMN IF EXISTS "resume_last_downloaded_at"`,
    );
  }

  // Restores the shape only — the object keys, tokens, and counts are gone for
  // good, and the S3 objects were purged separately. A revert leaves every
  // student with no hosted resume.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students"
        ADD COLUMN IF NOT EXISTS "resume_key" text,
        ADD COLUMN IF NOT EXISTS "resume_uploaded_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "resume_public_token" character varying(64),
        ADD COLUMN IF NOT EXISTS "resume_download_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "resume_last_downloaded_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "UQ_students_resume_public_token" UNIQUE ("resume_public_token")`,
    );
  }
}
