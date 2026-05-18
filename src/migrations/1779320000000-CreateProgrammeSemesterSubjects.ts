import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProgrammeSemesterSubjects1779320000000 implements MigrationInterface {
    name = 'CreateProgrammeSemesterSubjects1779320000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "programme_semester_subjects" ("id" SERIAL NOT NULL, "programme_semester_id" integer NOT NULL, "subject_id" integer, "placeholder_name" character varying(64), "credits" numeric(4,1) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_programme_semester_subjects_id" PRIMARY KEY ("id"))`);

        // Exactly one of subject_id / placeholder_name must be set — guards
        // against orphan rows where neither is populated. Credits must be > 0.
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_subject_xor_placeholder" CHECK ((subject_id IS NOT NULL AND placeholder_name IS NULL) OR (subject_id IS NULL AND placeholder_name IS NOT NULL))`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "CHK_pss_credits_positive" CHECK (credits > 0)`);

        await queryRunner.query(`CREATE INDEX "IDX_pss_programme_semester_id" ON "programme_semester_subjects" ("programme_semester_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_pss_subject_id" ON "programme_semester_subjects" ("subject_id")`);

        // Partial unique: the same real subject can't be added twice to the
        // same programme-semester. Elective slots (subject_id IS NULL) are
        // intentionally excluded so multiple "Open Elective" rows are allowed.
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_pss_programme_semester_subject" ON "programme_semester_subjects" ("programme_semester_id", "subject_id") WHERE "subject_id" IS NOT NULL`);

        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "FK_pss_programme_semester_id" FOREIGN KEY ("programme_semester_id") REFERENCES "programme_semesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" ADD CONSTRAINT "FK_pss_subject_id" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "FK_pss_subject_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "FK_pss_programme_semester_id"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_pss_programme_semester_subject"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pss_subject_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pss_programme_semester_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_credits_positive"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subjects" DROP CONSTRAINT "CHK_pss_subject_xor_placeholder"`);
        await queryRunner.query(`DROP TABLE "programme_semester_subjects"`);
    }

}
