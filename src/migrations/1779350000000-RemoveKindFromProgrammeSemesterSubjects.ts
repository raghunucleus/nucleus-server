import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveKindFromProgrammeSemesterSubjects1779350000000 implements MigrationInterface {
  name = 'RemoveKindFromProgrammeSemesterSubjects1779350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop any rows that exist purely because of the now-removed
    // 'extra' kind — they violate the restored credits > 0 rule and
    // are no longer representable anyway. Cascade kills any options
    // (extras never had options in practice, but belt + suspenders).
    await queryRunner.query(
      `DELETE FROM "programme_semester_subjects" WHERE "kind" = 'extra'`,
    );

    // Restore the original credit rule before dropping the kind column,
    // so we never leave the table without a credit constraint.
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: re-add the kind column with the 'subject' default so
    // existing rows backfill, infer 'elective' for placeholder rows,
    // then restore the kind-aware credit CHECK. Deleted 'extra' rows
    // cannot be recovered.
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD "kind" character varying(16) NOT NULL DEFAULT 'subject'`,
    );
    await queryRunner.query(
      `UPDATE "programme_semester_subjects" SET "kind" = 'elective' WHERE "placeholder_name" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ALTER COLUMN "kind" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_kind_values" CHECK (kind IN ('subject', 'elective', 'extra'))`,
    );

    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_credits_positive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_kind_credits" CHECK ((kind = 'extra' AND credits = 0) OR (kind IN ('subject', 'elective') AND credits > 0))`,
    );
  }
}
