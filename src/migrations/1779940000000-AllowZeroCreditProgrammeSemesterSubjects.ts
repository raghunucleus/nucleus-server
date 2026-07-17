import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowZeroCreditProgrammeSemesterSubjects1779940000000 implements MigrationInterface {
  name = 'AllowZeroCreditProgrammeSemesterSubjects1779940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Non-credit subjects (audit/mandatory/seminar entries) should be
    // representable, so relax the constraint from > 0 to >= 0.
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_credits_positive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_credits_non_negative" CHECK (credits >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_credits_non_negative"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_credits_positive" CHECK (credits > 0)`,
    );
  }
}
