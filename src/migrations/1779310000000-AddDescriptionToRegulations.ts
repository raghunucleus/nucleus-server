import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDescriptionToRegulations1779310000000 implements MigrationInterface {
  name = 'AddDescriptionToRegulations1779310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "regulations" ADD "description" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "regulations" DROP COLUMN "description"`,
    );
  }
}
