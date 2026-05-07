import { MigrationInterface, QueryRunner } from "typeorm";

export class AdminSchemaModification1778139390624 implements MigrationInterface {
    name = 'AdminSchemaModification1778139390624'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" DROP CONSTRAINT "PK_e3b38270c97a854c48d2e80874e"`);
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "id"`);
        await queryRunner.query(`ALTER TABLE "admins" ADD "id" SERIAL NOT NULL`);
        await queryRunner.query(`ALTER TABLE "admins" ADD CONSTRAINT "PK_e3b38270c97a854c48d2e80874e" PRIMARY KEY ("id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" DROP CONSTRAINT "PK_e3b38270c97a854c48d2e80874e"`);
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "id"`);
        await queryRunner.query(`ALTER TABLE "admins" ADD "id" uuid NOT NULL DEFAULT uuid_generate_v4()`);
        await queryRunner.query(`ALTER TABLE "admins" ADD CONSTRAINT "PK_e3b38270c97a854c48d2e80874e" PRIMARY KEY ("id")`);
    }

}
