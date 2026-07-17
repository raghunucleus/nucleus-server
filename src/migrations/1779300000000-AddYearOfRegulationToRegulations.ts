import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddYearOfRegulationToRegulations1779300000000 implements MigrationInterface {
  name = 'AddYearOfRegulationToRegulations1779300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing rows get a placeholder of 2000 so the NOT NULL add succeeds;
    // admins can correct them through the UI afterwards.
    await queryRunner.query(
      `ALTER TABLE "regulations" ADD "year_of_regulation" integer NOT NULL DEFAULT 2000`,
    );
    await queryRunner.query(
      `ALTER TABLE "regulations" ALTER COLUMN "year_of_regulation" DROP DEFAULT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "regulations" DROP COLUMN "year_of_regulation"`,
    );
  }
}
