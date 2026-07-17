import { MigrationInterface, QueryRunner } from 'typeorm';

// Resume links, take two. The public-bucket approach is replaced by a
// permanent tokenized route: `GET /public/resumes/<resume_public_token>`
// resolves the student's CURRENT resume_key and 302s to a short-lived
// presigned URL — so the link a student puts on job applications never
// changes (re-uploads swap the object, not the link), the bucket stays fully
// private, and the route can rate-limit and 404 on removal.
//
// `resume_external_url` is a SECOND, independent source (Drive, personal
// site): it never replaces the hosted file — both links are handed to
// recruiters and both stay live, so one failing still leaves a working copy.
export class AddResumeLinkFieldsToStudents1793400000000 implements MigrationInterface {
  name = 'AddResumeLinkFieldsToStudents1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students"
        ADD COLUMN IF NOT EXISTS "resume_public_token" character varying(64),
        ADD COLUMN IF NOT EXISTS "resume_external_url" character varying(512)`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "UQ_students_resume_public_token" UNIQUE ("resume_public_token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "UQ_students_resume_public_token"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students"
        DROP COLUMN IF EXISTS "resume_public_token",
        DROP COLUMN IF EXISTS "resume_external_url"`,
    );
  }
}
