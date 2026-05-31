import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDobToEmployees1781300000000 implements MigrationInterface {
    name = 'AddDobToEmployees1781300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "employees" ADD "dob" date`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN "dob"`);
    }

}
