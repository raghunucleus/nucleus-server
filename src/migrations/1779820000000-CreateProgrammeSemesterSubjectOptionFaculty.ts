import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProgrammeSemesterSubjectOptionFaculty1779820000000 implements MigrationInterface {
    name = 'CreateProgrammeSemesterSubjectOptionFaculty1779820000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "programme_semester_subject_option_faculty" ("id" SERIAL NOT NULL, "programme_semester_subject_option_id" integer NOT NULL, "employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_pss_opt_faculty_option_employee" UNIQUE ("programme_semester_subject_option_id", "employee_id"), CONSTRAINT "PK_pss_opt_faculty_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_pss_opt_faculty_option_id" ON "programme_semester_subject_option_faculty" ("programme_semester_subject_option_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_pss_opt_faculty_employee_id" ON "programme_semester_subject_option_faculty" ("employee_id")`);
        // Cascade on the candidate-subject row so removing it (or its parent
        // elective slot) cleans up the faculty links. Restrict on employee so
        // an allocated faculty can't be hard-deleted (only deactivated).
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_faculty" ADD CONSTRAINT "FK_pss_opt_faculty_option_id" FOREIGN KEY ("programme_semester_subject_option_id") REFERENCES "programme_semester_subject_options"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_faculty" ADD CONSTRAINT "FK_pss_opt_faculty_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_faculty" DROP CONSTRAINT "FK_pss_opt_faculty_employee_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_faculty" DROP CONSTRAINT "FK_pss_opt_faculty_option_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pss_opt_faculty_employee_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_pss_opt_faculty_option_id"`);
        await queryRunner.query(`DROP TABLE "programme_semester_subject_option_faculty"`);
    }

}
