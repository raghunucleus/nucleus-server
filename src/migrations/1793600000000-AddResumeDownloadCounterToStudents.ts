import { MigrationInterface, QueryRunner } from 'typeorm';

// Per-student resume download tracking. Every hit on the permanent public
// route (`GET /public/resumes/<token>`) bumps the counter, so unusual activity
// on a student's resume is visible to them and to admins.
//
// Cumulative PER PERSON: never reset by a re-upload or a removal. Counts
// Nucleus-link opens only — an external (Drive) link is handed to recruiters
// raw, on purpose, so its traffic never reaches us.
export class AddResumeDownloadCounterToStudents1793600000000 implements MigrationInterface {
  name = 'AddResumeDownloadCounterToStudents1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students"
        ADD COLUMN IF NOT EXISTS "resume_download_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "resume_last_downloaded_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students"
        DROP COLUMN IF EXISTS "resume_download_count",
        DROP COLUMN IF EXISTS "resume_last_downloaded_at"`,
    );
  }
}
