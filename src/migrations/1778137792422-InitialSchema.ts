import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1778137792422 implements MigrationInterface {
  name = 'InitialSchema1778137792422';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admins" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying(64) NOT NULL, "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e3b38270c97a854c48d2e80874e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4ba6d0c734d53f8e1b2e24b6c5" ON "admins" ("username") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_051db7d37d478a69a7432df147" ON "admins" ("email") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_051db7d37d478a69a7432df147"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ba6d0c734d53f8e1b2e24b6c5"`,
    );
    await queryRunner.query(`DROP TABLE "admins"`);
  }
}
