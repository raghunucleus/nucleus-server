import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Renames the programme_regulations table to programme_admission_years. The
 * row models the (programme, admission_year) batch and currently carries one
 * field (regulation_id); the new name leaves room for more attributes there
 * over time. This is a clean-slate rename — any existing data is dropped.
 */
export class RenameProgrammeRegulationsToProgrammeAdmissionYears1779420000000
  implements MigrationInterface
{
    name = 'RenameProgrammeRegulationsToProgrammeAdmissionYears1779420000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "programme_regulations" CASCADE`);
        await queryRunner.query(`CREATE TABLE "programme_admission_years" ("id" SERIAL NOT NULL, "programme_id" integer NOT NULL, "admission_year_id" integer NOT NULL, "regulation_id" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_programme_admission_years_programme_admission_year" UNIQUE ("programme_id", "admission_year_id"), CONSTRAINT "PK_programme_admission_years_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_admission_years_programme_id" ON "programme_admission_years" ("programme_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_admission_years_admission_year_id" ON "programme_admission_years" ("admission_year_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_admission_years_regulation_id" ON "programme_admission_years" ("regulation_id")`);
        await queryRunner.query(`ALTER TABLE "programme_admission_years" ADD CONSTRAINT "FK_programme_admission_years_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_admission_years" ADD CONSTRAINT "FK_programme_admission_years_admission_year_id" FOREIGN KEY ("admission_year_id") REFERENCES "admission_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_admission_years" ADD CONSTRAINT "FK_programme_admission_years_regulation_id" FOREIGN KEY ("regulation_id") REFERENCES "regulations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programme_admission_years" DROP CONSTRAINT "FK_programme_admission_years_regulation_id"`);
        await queryRunner.query(`ALTER TABLE "programme_admission_years" DROP CONSTRAINT "FK_programme_admission_years_admission_year_id"`);
        await queryRunner.query(`ALTER TABLE "programme_admission_years" DROP CONSTRAINT "FK_programme_admission_years_programme_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_admission_years_regulation_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_admission_years_admission_year_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_admission_years_programme_id"`);
        await queryRunner.query(`DROP TABLE "programme_admission_years"`);
        await queryRunner.query(`CREATE TABLE "programme_regulations" ("id" SERIAL NOT NULL, "programme_id" integer NOT NULL, "admission_year_id" integer NOT NULL, "regulation_id" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_programme_regulations_programme_admission_year" UNIQUE ("programme_id", "admission_year_id"), CONSTRAINT "PK_programme_regulations_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_regulations_programme_id" ON "programme_regulations" ("programme_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_regulations_admission_year_id" ON "programme_regulations" ("admission_year_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_regulations_regulation_id" ON "programme_regulations" ("regulation_id")`);
        await queryRunner.query(`ALTER TABLE "programme_regulations" ADD CONSTRAINT "FK_programme_regulations_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_regulations" ADD CONSTRAINT "FK_programme_regulations_admission_year_id" FOREIGN KEY ("admission_year_id") REFERENCES "admission_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_regulations" ADD CONSTRAINT "FK_programme_regulations_regulation_id" FOREIGN KEY ("regulation_id") REFERENCES "regulations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }
}
