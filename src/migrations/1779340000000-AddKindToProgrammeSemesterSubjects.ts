import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKindToProgrammeSemesterSubjects1779340000000 implements MigrationInterface {
  name = 'AddKindToProgrammeSemesterSubjects1779340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the kind column with a temporary default so existing NOT NULL
    // rows backfill cleanly; we'll drop the default afterwards.
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD "kind" character varying(16) NOT NULL DEFAULT 'subject'`,
    );

    // Backfill: every row that was an elective slot (placeholder_name set)
    // becomes kind='elective'. The rest stay as 'subject' from the
    // default. No row could have been an extra before this migration.
    await queryRunner.query(
      `UPDATE "programme_semester_subjects" SET "kind" = 'elective' WHERE "placeholder_name" IS NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ALTER COLUMN "kind" DROP DEFAULT`,
    );

    // Restrict to the three accepted values. Future kinds can be added by
    // dropping & re-adding this constraint.
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_kind_values" CHECK (kind IN ('subject', 'elective', 'extra'))`,
    );

    // Replace the unconditional `credits > 0` rule with a kind-aware one:
    // extras must have credits = 0, all other kinds must be > 0.
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_credits_positive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_kind_credits" CHECK ((kind = 'extra' AND credits = 0) OR (kind IN ('subject', 'elective') AND credits > 0))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_kind_credits"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_credits_positive" CHECK (credits > 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_kind_values"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" DROP COLUMN "kind"`,
    );
  }
}
