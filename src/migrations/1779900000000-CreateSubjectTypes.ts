import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSubjectTypes1779900000000 implements MigrationInterface {
    name = 'CreateSubjectTypes1779900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "subject_types" ("id" SERIAL NOT NULL, "name" character varying(128) NOT NULL, "code" character varying(32) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_subject_types_name" UNIQUE ("name"), CONSTRAINT "UQ_subject_types_code" UNIQUE ("code"), CONSTRAINT "PK_subject_types_id" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "subject_types"`);
    }

}
