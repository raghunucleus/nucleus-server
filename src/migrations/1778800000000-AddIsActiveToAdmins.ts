import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsActiveToAdmins1778800000000 implements MigrationInterface {
    name = 'AddIsActiveToAdmins1778800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" ADD "is_active" boolean NOT NULL DEFAULT true`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admins" DROP COLUMN "is_active"`);
    }

}
