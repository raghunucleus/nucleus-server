import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProgrammeRegulations1779290000000 implements MigrationInterface {
    name = 'CreateProgrammeRegulations1779290000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "programme_regulations" ("id" SERIAL NOT NULL, "programme_id" integer NOT NULL, "admission_year_id" integer NOT NULL, "regulation_id" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_programme_regulations_programme_admission_year" UNIQUE ("programme_id", "admission_year_id"), CONSTRAINT "PK_programme_regulations_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_regulations_programme_id" ON "programme_regulations" ("programme_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_regulations_admission_year_id" ON "programme_regulations" ("admission_year_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_regulations_regulation_id" ON "programme_regulations" ("regulation_id")`);
        await queryRunner.query(`ALTER TABLE "programme_regulations" ADD CONSTRAINT "FK_programme_regulations_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_regulations" ADD CONSTRAINT "FK_programme_regulations_admission_year_id" FOREIGN KEY ("admission_year_id") REFERENCES "admission_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_regulations" ADD CONSTRAINT "FK_programme_regulations_regulation_id" FOREIGN KEY ("regulation_id") REFERENCES "regulations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programme_regulations" DROP CONSTRAINT "FK_programme_regulations_regulation_id"`);
        await queryRunner.query(`ALTER TABLE "programme_regulations" DROP CONSTRAINT "FK_programme_regulations_admission_year_id"`);
        await queryRunner.query(`ALTER TABLE "programme_regulations" DROP CONSTRAINT "FK_programme_regulations_programme_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_regulations_regulation_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_regulations_admission_year_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_regulations_programme_id"`);
        await queryRunner.query(`DROP TABLE "programme_regulations"`);
    }

}
