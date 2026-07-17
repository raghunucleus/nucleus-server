import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusToProgrammeSemesters1779360000000 implements MigrationInterface {
  name = 'AddStatusToProgrammeSemesters1779360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Lifecycle state of a programme-semester row. Default to 'upcoming'
    // so existing rows backfill cleanly. Constrained to the three values
    // the admin can move between (upcoming -> ongoing -> completed).
    await queryRunner.query(
      `ALTER TABLE "programme_semesters" ADD "status" character varying(16) NOT NULL DEFAULT 'upcoming'`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semesters" ADD CONSTRAINT "CHK_programme_semesters_status_values" CHECK (status IN ('upcoming', 'ongoing', 'completed'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "programme_semesters" DROP CONSTRAINT "CHK_programme_semesters_status_values"`,
    );
    await queryRunner.query(
      `ALTER TABLE "programme_semesters" DROP COLUMN "status"`,
    );
  }
}
