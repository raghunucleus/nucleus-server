import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsMasterAdminToAdmins1778148391463 implements MigrationInterface {
  name = 'AddIsMasterAdminToAdmins1778148391463';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ba6d0c734d53f8e1b2e24b6c5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_051db7d37d478a69a7432df147"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" ADD "is_master_admin" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" ADD CONSTRAINT "UQ_admins_username" UNIQUE ("username")`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" ADD CONSTRAINT "UQ_admins_email" UNIQUE ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "admins" DROP CONSTRAINT "UQ_admins_email"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" DROP CONSTRAINT "UQ_admins_username"`,
    );
    await queryRunner.query(
      `ALTER TABLE "admins" DROP COLUMN "is_master_admin"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_051db7d37d478a69a7432df147" ON "admins" ("email") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4ba6d0c734d53f8e1b2e24b6c5" ON "admins" ("username") `,
    );
  }
}
