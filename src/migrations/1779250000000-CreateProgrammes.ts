import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProgrammes1779250000000 implements MigrationInterface {
    name = 'CreateProgrammes1779250000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "programmes" ("id" SERIAL NOT NULL, "name" character varying(256) NOT NULL, "code" character varying(32) NOT NULL, "display_name" character varying(128) NOT NULL, "degree_id" integer NOT NULL, "department_id" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_programmes_name" UNIQUE ("name"), CONSTRAINT "UQ_programmes_code" UNIQUE ("code"), CONSTRAINT "PK_programmes_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_programmes_degree_id" ON "programmes" ("degree_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programmes_department_id" ON "programmes" ("department_id")`);
        await queryRunner.query(`ALTER TABLE "programmes" ADD CONSTRAINT "FK_programmes_degree_id" FOREIGN KEY ("degree_id") REFERENCES "degrees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programmes" ADD CONSTRAINT "FK_programmes_department_id" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programmes" DROP CONSTRAINT "FK_programmes_department_id"`);
        await queryRunner.query(`ALTER TABLE "programmes" DROP CONSTRAINT "FK_programmes_degree_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programmes_department_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programmes_degree_id"`);
        await queryRunner.query(`DROP TABLE "programmes"`);
    }

}
