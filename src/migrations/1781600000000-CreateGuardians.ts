import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGuardians1781600000000 implements MigrationInterface {
    name = 'CreateGuardians1781600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "guardians" ("id" SERIAL NOT NULL, "mobile_number" character varying(16) NOT NULL, "display_name" character varying(128) NOT NULL, "email" character varying(255), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_guardians_mobile_number" UNIQUE ("mobile_number"), CONSTRAINT "PK_guardians_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_guardians_email" ON "guardians" ("email")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_guardians_email"`);
        await queryRunner.query(`DROP TABLE "guardians"`);
    }

}
