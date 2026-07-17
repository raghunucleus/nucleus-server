import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleIdToAdmins1778700000000 implements MigrationInterface {
  name = 'AddGoogleIdToAdmins1778700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admins" ADD "google_id" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" ADD CONSTRAINT "UQ_admins_google_id" UNIQUE ("google_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admins" DROP CONSTRAINT "UQ_admins_google_id"`,
    );
    await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "google_id"`);
  }
}
