import { MigrationInterface, QueryRunner } from "typeorm";

export class Adminprofileedit1778153204099 implements MigrationInterface {
    name = 'Adminprofileedit1778153204099'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" ADD "first_name" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "admins" ADD "last_name" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "admins" ADD "mobile_number" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "admins" ADD "display_name" character varying(129)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "display_name"`);
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "mobile_number"`);
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "last_name"`);
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "first_name"`);
    }

}
