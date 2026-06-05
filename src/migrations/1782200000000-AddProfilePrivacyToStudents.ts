import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-attribute profile privacy. Two fields get their own boolean column:
 *  - `birthday_hidden` (default false = visible) so the set-based classmate-
 *    birthdays query can filter it with a sargable predicate.
 *  - `mobile_hidden` (default **true = hidden**) — a phone number is sensitive
 *    PII, so it's hidden from peers by default; a student opts in to show it.
 *    Existing students are backfilled to hidden by the column default.
 *
 * The remaining hideable fields (photo/email/blood_group/gender) ride the
 * `hidden_profile_fields` jsonb array (default '[]' = visible). Only hidden
 * fields are ever stored.
 */
export class AddProfilePrivacyToStudents1782200000000 implements MigrationInterface {
  name = 'AddProfilePrivacyToStudents1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD "birthday_hidden" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD "mobile_hidden" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" ADD "hidden_profile_fields" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "hidden_profile_fields"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "mobile_hidden"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP COLUMN "birthday_hidden"`,
    );
  }
}
