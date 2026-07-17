import { MigrationInterface, QueryRunner } from 'typeorm';

// Timetable feature — five tables:
//   timetables             one schedule for an attendance group × semester,
//                          with effective dates so revisions can be planned.
//   timetable_periods      the per-timetable bell schedule (grid rows).
//   timetable_courses      subjects added exclusively to a timetable.
//   timetable_course_faculty  faculty mapped to those exclusive courses.
//   timetable_entries      the filled grid cells (one class per day×period).
export class CreateTimetables1779870000000 implements MigrationInterface {
  name = 'CreateTimetables1779870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- timetables -----------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "timetables" ("id" SERIAL NOT NULL, "programme_semester_id" integer NOT NULL, "attendance_group_id" integer NOT NULL, "name" character varying(96) NOT NULL, "effective_from" date NOT NULL, "effective_to" date, "status" character varying(16) NOT NULL DEFAULT 'draft', "working_days" jsonb NOT NULL DEFAULT '[1,2,3,4,5]', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_timetables_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_timetables_programme_semester_id" ON "timetables" ("programme_semester_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_timetables_attendance_group_id" ON "timetables" ("attendance_group_id")`,
    );
    // Restrict on both parents — a semester or attendance group can't be
    // hard-deleted while a timetable references it.
    await queryRunner.query(
      `ALTER TABLE "timetables" ADD CONSTRAINT "FK_timetables_programme_semester_id" FOREIGN KEY ("programme_semester_id") REFERENCES "programme_semesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetables" ADD CONSTRAINT "FK_timetables_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- timetable_periods ---------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "timetable_periods" ("id" SERIAL NOT NULL, "timetable_id" integer NOT NULL, "position" smallint NOT NULL, "label" character varying(48) NOT NULL, "start_time" TIME NOT NULL, "end_time" TIME NOT NULL, "is_break" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_timetable_periods_timetable_id_position" UNIQUE ("timetable_id", "position"), CONSTRAINT "PK_timetable_periods_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_timetable_periods_timetable_id" ON "timetable_periods" ("timetable_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_periods" ADD CONSTRAINT "FK_timetable_periods_timetable_id" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // --- timetable_courses ---------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "timetable_courses" ("id" SERIAL NOT NULL, "timetable_id" integer NOT NULL, "subject_id" integer, "custom_label" character varying(96), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_timetable_courses_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_timetable_courses_timetable_id" ON "timetable_courses" ("timetable_id")`,
    );
    // Cascade on the timetable so deleting it cleans up its extra courses.
    // Restrict on subject so a referenced master subject can't be deleted.
    await queryRunner.query(
      `ALTER TABLE "timetable_courses" ADD CONSTRAINT "FK_timetable_courses_timetable_id" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_courses" ADD CONSTRAINT "FK_timetable_courses_subject_id" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- timetable_course_faculty --------------------------------------
    await queryRunner.query(
      `CREATE TABLE "timetable_course_faculty" ("id" SERIAL NOT NULL, "timetable_course_id" integer NOT NULL, "employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ttc_faculty_course_employee" UNIQUE ("timetable_course_id", "employee_id"), CONSTRAINT "PK_ttc_faculty_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ttc_faculty_course_id" ON "timetable_course_faculty" ("timetable_course_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ttc_faculty_employee_id" ON "timetable_course_faculty" ("employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_course_faculty" ADD CONSTRAINT "FK_ttc_faculty_course_id" FOREIGN KEY ("timetable_course_id") REFERENCES "timetable_courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_course_faculty" ADD CONSTRAINT "FK_ttc_faculty_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- timetable_entries ---------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "timetable_entries" ("id" SERIAL NOT NULL, "timetable_id" integer NOT NULL, "day_of_week" smallint NOT NULL, "timetable_period_id" integer NOT NULL, "programme_semester_subject_id" integer, "timetable_course_id" integer, "employee_id" integer, "room" character varying(48), "note" character varying(160), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_timetable_entries_timetable_day_period" UNIQUE ("timetable_id", "day_of_week", "timetable_period_id"), CONSTRAINT "PK_timetable_entries_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_timetable_entries_timetable_id" ON "timetable_entries" ("timetable_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_timetable_entries_employee_id" ON "timetable_entries" ("employee_id")`,
    );
    // Cascade on timetable / period / course so removing any of them
    // clears the affected cells. Cascade on the semester subject too —
    // dropping a subject from the semester drops its scheduled cells.
    // Restrict on employee so an assigned teacher can't be hard-deleted.
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" ADD CONSTRAINT "FK_timetable_entries_timetable_id" FOREIGN KEY ("timetable_id") REFERENCES "timetables"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" ADD CONSTRAINT "FK_timetable_entries_period_id" FOREIGN KEY ("timetable_period_id") REFERENCES "timetable_periods"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" ADD CONSTRAINT "FK_timetable_entries_pss_id" FOREIGN KEY ("programme_semester_subject_id") REFERENCES "programme_semester_subjects"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" ADD CONSTRAINT "FK_timetable_entries_course_id" FOREIGN KEY ("timetable_course_id") REFERENCES "timetable_courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" ADD CONSTRAINT "FK_timetable_entries_employee_id" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" DROP CONSTRAINT "FK_timetable_entries_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" DROP CONSTRAINT "FK_timetable_entries_course_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" DROP CONSTRAINT "FK_timetable_entries_pss_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" DROP CONSTRAINT "FK_timetable_entries_period_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_entries" DROP CONSTRAINT "FK_timetable_entries_timetable_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_timetable_entries_employee_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_timetable_entries_timetable_id"`,
    );
    await queryRunner.query(`DROP TABLE "timetable_entries"`);

    await queryRunner.query(
      `ALTER TABLE "timetable_course_faculty" DROP CONSTRAINT "FK_ttc_faculty_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_course_faculty" DROP CONSTRAINT "FK_ttc_faculty_course_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ttc_faculty_employee_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ttc_faculty_course_id"`);
    await queryRunner.query(`DROP TABLE "timetable_course_faculty"`);

    await queryRunner.query(
      `ALTER TABLE "timetable_courses" DROP CONSTRAINT "FK_timetable_courses_subject_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetable_courses" DROP CONSTRAINT "FK_timetable_courses_timetable_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_timetable_courses_timetable_id"`,
    );
    await queryRunner.query(`DROP TABLE "timetable_courses"`);

    await queryRunner.query(
      `ALTER TABLE "timetable_periods" DROP CONSTRAINT "FK_timetable_periods_timetable_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_timetable_periods_timetable_id"`,
    );
    await queryRunner.query(`DROP TABLE "timetable_periods"`);

    await queryRunner.query(
      `ALTER TABLE "timetables" DROP CONSTRAINT "FK_timetables_attendance_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetables" DROP CONSTRAINT "FK_timetables_programme_semester_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_timetables_attendance_group_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_timetables_programme_semester_id"`,
    );
    await queryRunner.query(`DROP TABLE "timetables"`);
  }
}
