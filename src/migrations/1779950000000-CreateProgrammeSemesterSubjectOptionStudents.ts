import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProgrammeSemesterSubjectOptionStudents1779950000000 implements MigrationInterface {
    name = 'CreateProgrammeSemesterSubjectOptionStudents1779950000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // employee_id captures the specific faculty teaching this student
        // for the chosen candidate — a candidate may have multiple faculty
        // allocated, and the student's timetable/attendance follows whoever
        // is recorded here. Service-layer guards that the (option_id,
        // employee_id) pair is one of the option's allocated faculty.
        await queryRunner.query(`CREATE TABLE "programme_semester_subject_option_students" ("id" SERIAL NOT NULL, "programme_semester_subject_option_id" integer NOT NULL, "programme_semester_subject_id" integer NOT NULL, "student_id" integer NOT NULL, "employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_programme_semester_subject_option_students_id" PRIMARY KEY ("id"))`);

        // One row per (candidate, student). Stops the same student being
        // double-enrolled in the same candidate; the per-slot uniqueness is
        // enforced by the second UNIQUE below.
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" ADD CONSTRAINT "UQ_pss_opt_students_option_student" UNIQUE ("programme_semester_subject_option_id", "student_id")`);

        // A student can only pick ONE candidate per slot. The slot id is
        // denormalised onto the row so the DB can enforce this without a
        // cross-table check.
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" ADD CONSTRAINT "UQ_pss_opt_students_slot_student" UNIQUE ("programme_semester_subject_id", "student_id")`);

        await queryRunner.query(`CREATE INDEX "IDX_pss_opt_students_option_id" ON "programme_semester_subject_option_students" ("programme_semester_subject_option_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_pss_opt_students_slot_id" ON "programme_semester_subject_option_students" ("programme_semester_subject_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_pss_opt_students_student_id" ON "programme_semester_subject_option_students" ("student_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_pss_opt_students_employee_id" ON "programme_semester_subject_option_students" ("employee_id")`);

        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" ADD CONSTRAINT "FK_pss_opt_students_option_id" FOREIGN KEY ("programme_semester_subject_option_id") REFERENCES "programme_semester_subject_options"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" ADD CONSTRAINT "FK_pss_opt_students_slot_id" FOREIGN KEY ("programme_semester_subject_id") REFERENCES "programme_semester_subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" ADD CONSTRAINT "FK_pss_opt_students_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" ADD CONSTRAINT "FK_pss_opt_students_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // IF EXISTS on every drop so a revert is safe even when the table
        // was created by an older version of this same migration (e.g. the
        // pre-employee_id revision that some dev DBs already ran).
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" DROP CONSTRAINT IF EXISTS "FK_pss_opt_students_employee_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" DROP CONSTRAINT IF EXISTS "FK_pss_opt_students_student_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" DROP CONSTRAINT IF EXISTS "FK_pss_opt_students_slot_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" DROP CONSTRAINT IF EXISTS "FK_pss_opt_students_option_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_pss_opt_students_employee_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_pss_opt_students_student_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_pss_opt_students_slot_id"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_pss_opt_students_option_id"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" DROP CONSTRAINT IF EXISTS "UQ_pss_opt_students_slot_student"`);
        await queryRunner.query(`ALTER TABLE "programme_semester_subject_option_students" DROP CONSTRAINT IF EXISTS "UQ_pss_opt_students_option_student"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "programme_semester_subject_option_students"`);
    }

}
