import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeStudentDobNotNull1779510000000 implements MigrationInterface {
    name = 'MakeStudentDobNotNull1779510000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "dob" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "students" ALTER COLUMN "dob" DROP NOT NULL`);
    }

}
