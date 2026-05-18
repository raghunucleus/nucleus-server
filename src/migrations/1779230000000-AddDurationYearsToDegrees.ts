import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDurationYearsToDegrees1779230000000 implements MigrationInterface {
    name = 'AddDurationYearsToDegrees1779230000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Existing rows get a default of 1; admins can edit afterwards.
        await queryRunner.query(`ALTER TABLE "degrees" ADD "duration_years" integer NOT NULL DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "degrees" ALTER COLUMN "duration_years" DROP DEFAULT`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "degrees" DROP COLUMN "duration_years"`);
    }

}
