import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEntryTypeToStudents1782000000000 implements MigrationInterface {
  name = 'AddEntryTypeToStudents1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students" ADD "entry_type" smallint NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "students" DROP COLUMN "entry_type"`);
  }
}
