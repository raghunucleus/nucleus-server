import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGoogleIdToStudentCredentials1779800000000 implements MigrationInterface {
    name = 'AddGoogleIdToStudentCredentials1779800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "student_credentials" ADD "google_id" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "student_credentials" ADD CONSTRAINT "UQ_student_credentials_google_id" UNIQUE ("google_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "student_credentials" DROP CONSTRAINT "UQ_student_credentials_google_id"`);
        await queryRunner.query(`ALTER TABLE "student_credentials" DROP COLUMN "google_id"`);
    }

}
