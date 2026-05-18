import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProgrammeSemesters1779260000000 implements MigrationInterface {
    name = 'CreateProgrammeSemesters1779260000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "programme_semesters" ("id" SERIAL NOT NULL, "programme_id" integer NOT NULL, "admission_year_id" integer NOT NULL, "semester_id" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_programme_semesters_programme_admission_year_semester" UNIQUE ("programme_id", "admission_year_id", "semester_id"), CONSTRAINT "PK_programme_semesters_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_semesters_programme_id" ON "programme_semesters" ("programme_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_semesters_admission_year_id" ON "programme_semesters" ("admission_year_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_programme_semesters_semester_id" ON "programme_semesters" ("semester_id")`);
        await queryRunner.query(`ALTER TABLE "programme_semesters" ADD CONSTRAINT "FK_programme_semesters_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_semesters" ADD CONSTRAINT "FK_programme_semesters_admission_year_id" FOREIGN KEY ("admission_year_id") REFERENCES "admission_years"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_semesters" ADD CONSTRAINT "FK_programme_semesters_semester_id" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programme_semesters" DROP CONSTRAINT "FK_programme_semesters_semester_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semesters" DROP CONSTRAINT "FK_programme_semesters_admission_year_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semesters" DROP CONSTRAINT "FK_programme_semesters_programme_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_semesters_semester_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_semesters_admission_year_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_programme_semesters_programme_id"`);
        await queryRunner.query(`DROP TABLE "programme_semesters"`);
    }

}
