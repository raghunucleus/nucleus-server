import { MigrationInterface, QueryRunner } from 'typeorm';

// Attendance feature — seven tables plus one column added to
// programme_semester_subjects.
//
//   academic_holidays            no-class days the seeder honours
//   class_sessions               one actual class per (date, period) — the
//                                row attendance hangs off
//   class_session_attendance     teacher-marked rows for a session
//   student_subject_attendance   per (student × ps × subject) rollup
//   attendance_adjustments       ledger for OD / medical / manual fixes
//   class_session_audit_logs     append-only audit on every session mutation
//   student_group_history        effective-dated group membership
//
// Column:
//   programme_semester_subjects.cohort_scope  controls whether an elective
//                                slot's cohorts merge across attendance
//                                groups ('programme_semester') or stay
//                                per-group ('group', default).
export class CreateAttendanceSessions1780400000000 implements MigrationInterface {
  name = 'CreateAttendanceSessions1780400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- programme_semester_subjects.cohort_scope -----------------------
    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" ADD "cohort_scope" character varying(24) NOT NULL DEFAULT 'group'`,
    );

    // --- academic_holidays ---------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "academic_holidays" ("id" SERIAL NOT NULL, "date" date NOT NULL, "end_date" date, "name" character varying(120) NOT NULL, "scope" character varying(16) NOT NULL, "programme_id" integer, "attendance_group_id" integer, "type" character varying(32) NOT NULL, "reason" character varying(256), "declared_by_employee_id" integer, "declared_by_admin_id" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_academic_holidays_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_academic_holidays_date" ON "academic_holidays" ("date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_academic_holidays_programme_id" ON "academic_holidays" ("programme_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_academic_holidays_attendance_group_id" ON "academic_holidays" ("attendance_group_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "FK_academic_holidays_programme_id" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "FK_academic_holidays_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "FK_academic_holidays_declared_by_employee_id" FOREIGN KEY ("declared_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "FK_academic_holidays_declared_by_admin_id" FOREIGN KEY ("declared_by_admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // Scope ↔ FK pairing. 'institution' carries no scope FK; 'programme'
    // requires programme_id; 'group' requires attendance_group_id (and we
    // also leave programme_id NULL since the group implies it).
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "CHK_academic_holidays_scope_fks" CHECK ((scope = 'institution' AND programme_id IS NULL AND attendance_group_id IS NULL) OR (scope = 'programme' AND programme_id IS NOT NULL AND attendance_group_id IS NULL) OR (scope = 'group' AND attendance_group_id IS NOT NULL))`,
    );
    // Exactly one declarer — admin OR employee, never neither, never both.
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "CHK_academic_holidays_declarer" CHECK ((declared_by_employee_id IS NULL) <> (declared_by_admin_id IS NULL))`,
    );
    // end_date, if set, must not precede date.
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" ADD CONSTRAINT "CHK_academic_holidays_end_date_order" CHECK (end_date IS NULL OR end_date >= date)`,
    );

    // --- class_sessions -------------------------------------------------
    await queryRunner.query(
      `CREATE TABLE "class_sessions" ("id" SERIAL NOT NULL, "session_date" date NOT NULL, "day_of_week" smallint NOT NULL, "programme_semester_id" integer NOT NULL, "attendance_group_id" integer, "timetable_period_id" integer NOT NULL, "span" smallint NOT NULL DEFAULT 1, "timetable_entry_id" integer, "programme_semester_subject_id" integer NOT NULL, "programme_semester_subject_option_id" integer, "subject_id" integer NOT NULL, "scheduled_employee_id" integer NOT NULL, "effective_employee_id" integer NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'scheduled', "rescheduled_to_session_id" integer, "cancel_reason" character varying(256), "room" character varying(48), "note" character varying(256), "attendance_marked_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_class_sessions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_sessions_group_date" ON "class_sessions" ("attendance_group_id", "session_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_sessions_ps_date" ON "class_sessions" ("programme_semester_id", "session_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_sessions_teacher_date" ON "class_sessions" ("effective_employee_id", "session_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_sessions_subject_date" ON "class_sessions" ("subject_id", "session_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_sessions_status" ON "class_sessions" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_sessions_timetable_entry_id" ON "class_sessions" ("timetable_entry_id")`,
    );
    // Idempotency key for the seeder: every distinct cell-on-a-date is
    // one row. Expression index lets nullable scope columns participate
    // via COALESCE without UPSERT gymnastics. Sentinel `0` is safe — all
    // referenced PKs are SERIAL starting at 1.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_class_sessions_key" ON "class_sessions" ((COALESCE("attendance_group_id", 0)), "programme_semester_id", "session_date", "timetable_period_id", "programme_semester_subject_id", (COALESCE("programme_semester_subject_option_id", 0)), "scheduled_employee_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_programme_semester_id" FOREIGN KEY ("programme_semester_id") REFERENCES "programme_semesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_timetable_period_id" FOREIGN KEY ("timetable_period_id") REFERENCES "timetable_periods"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_timetable_entry_id" FOREIGN KEY ("timetable_entry_id") REFERENCES "timetable_entries"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_pss_id" FOREIGN KEY ("programme_semester_subject_id") REFERENCES "programme_semester_subjects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_pss_option_id" FOREIGN KEY ("programme_semester_subject_option_id") REFERENCES "programme_semester_subject_options"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_subject_id" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_scheduled_employee_id" FOREIGN KEY ("scheduled_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_effective_employee_id" FOREIGN KEY ("effective_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" ADD CONSTRAINT "FK_class_sessions_rescheduled_to_session_id" FOREIGN KEY ("rescheduled_to_session_id") REFERENCES "class_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // --- class_session_attendance --------------------------------------
    await queryRunner.query(
      `CREATE TABLE "class_session_attendance" ("id" SERIAL NOT NULL, "class_session_id" integer NOT NULL, "student_id" integer NOT NULL, "status" character varying(16) NOT NULL, "marked_at" TIMESTAMP NOT NULL, "marked_by_employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_class_session_attendance_session_student" UNIQUE ("class_session_id", "student_id"), CONSTRAINT "PK_class_session_attendance_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_session_attendance_student_id" ON "class_session_attendance" ("student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_class_session_attendance_class_session_id" ON "class_session_attendance" ("class_session_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_session_attendance" ADD CONSTRAINT "FK_csa_class_session_id" FOREIGN KEY ("class_session_id") REFERENCES "class_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_session_attendance" ADD CONSTRAINT "FK_csa_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_session_attendance" ADD CONSTRAINT "FK_csa_marked_by_employee_id" FOREIGN KEY ("marked_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- student_subject_attendance ------------------------------------
    await queryRunner.query(
      `CREATE TABLE "student_subject_attendance" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "programme_semester_id" integer NOT NULL, "subject_id" integer NOT NULL, "attended_count" integer NOT NULL DEFAULT 0, "held_count" integer NOT NULL DEFAULT 0, "last_session_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_ssa_student_ps_subject" UNIQUE ("student_id", "programme_semester_id", "subject_id"), CONSTRAINT "PK_student_subject_attendance_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ssa_student_id" ON "student_subject_attendance" ("student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ssa_subject_id" ON "student_subject_attendance" ("subject_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_attendance" ADD CONSTRAINT "FK_ssa_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_attendance" ADD CONSTRAINT "FK_ssa_programme_semester_id" FOREIGN KEY ("programme_semester_id") REFERENCES "programme_semesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_attendance" ADD CONSTRAINT "FK_ssa_subject_id" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- attendance_adjustments ----------------------------------------
    await queryRunner.query(
      `CREATE TABLE "attendance_adjustments" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "programme_semester_id" integer NOT NULL, "subject_id" integer, "attended_delta" integer NOT NULL DEFAULT 0, "held_delta" integer NOT NULL DEFAULT 0, "source" character varying(32) NOT NULL, "reason" character varying(256) NOT NULL, "effective_date" date NOT NULL, "approved_by_employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_attendance_adjustments_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_adjustments_student_ps" ON "attendance_adjustments" ("student_id", "programme_semester_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_adjustments_subject_id" ON "attendance_adjustments" ("subject_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_att_adjustments_effective_date" ON "attendance_adjustments" ("effective_date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "FK_att_adj_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "FK_att_adj_programme_semester_id" FOREIGN KEY ("programme_semester_id") REFERENCES "programme_semesters"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "FK_att_adj_subject_id" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_adjustments" ADD CONSTRAINT "FK_att_adj_approved_by_employee_id" FOREIGN KEY ("approved_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- class_session_audit_logs --------------------------------------
    await queryRunner.query(
      `CREATE TABLE "class_session_audit_logs" ("id" SERIAL NOT NULL, "class_session_id" integer, "action" character varying(32) NOT NULL, "before" jsonb, "after" jsonb, "reason" character varying(256), "performed_by_employee_id" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_class_session_audit_logs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cs_audit_class_session_id" ON "class_session_audit_logs" ("class_session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cs_audit_performed_by_employee_id" ON "class_session_audit_logs" ("performed_by_employee_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cs_audit_action_created_at" ON "class_session_audit_logs" ("action", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_session_audit_logs" ADD CONSTRAINT "FK_cs_audit_class_session_id" FOREIGN KEY ("class_session_id") REFERENCES "class_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_session_audit_logs" ADD CONSTRAINT "FK_cs_audit_performed_by_employee_id" FOREIGN KEY ("performed_by_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // --- student_group_history -----------------------------------------
    await queryRunner.query(
      `CREATE TABLE "student_group_history" ("id" SERIAL NOT NULL, "student_id" integer NOT NULL, "attendance_group_id" integer, "effective_from" date NOT NULL, "effective_to" date, "changed_by_employee_id" integer, "reason" character varying(256), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_student_group_history_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sg_history_student_id" ON "student_group_history" ("student_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sg_history_attendance_group_id" ON "student_group_history" ("attendance_group_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sg_history_effective_from" ON "student_group_history" ("effective_from")`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_group_history" ADD CONSTRAINT "FK_sg_history_student_id" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_group_history" ADD CONSTRAINT "FK_sg_history_attendance_group_id" FOREIGN KEY ("attendance_group_id") REFERENCES "attendance_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_group_history" ADD CONSTRAINT "FK_sg_history_changed_by_employee_id" FOREIGN KEY ("changed_by_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // effective_to, if set, must not precede effective_from.
    await queryRunner.query(
      `ALTER TABLE "student_group_history" ADD CONSTRAINT "CHK_sg_history_effective_order" CHECK (effective_to IS NULL OR effective_to >= effective_from)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "student_group_history" DROP CONSTRAINT "CHK_sg_history_effective_order"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_group_history" DROP CONSTRAINT "FK_sg_history_changed_by_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_group_history" DROP CONSTRAINT "FK_sg_history_attendance_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_group_history" DROP CONSTRAINT "FK_sg_history_student_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sg_history_effective_from"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_sg_history_attendance_group_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_sg_history_student_id"`);
    await queryRunner.query(`DROP TABLE "student_group_history"`);

    await queryRunner.query(
      `ALTER TABLE "class_session_audit_logs" DROP CONSTRAINT "FK_cs_audit_performed_by_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_session_audit_logs" DROP CONSTRAINT "FK_cs_audit_class_session_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cs_audit_action_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cs_audit_performed_by_employee_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cs_audit_class_session_id"`,
    );
    await queryRunner.query(`DROP TABLE "class_session_audit_logs"`);

    await queryRunner.query(
      `ALTER TABLE "attendance_adjustments" DROP CONSTRAINT "FK_att_adj_approved_by_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_adjustments" DROP CONSTRAINT "FK_att_adj_subject_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_adjustments" DROP CONSTRAINT "FK_att_adj_programme_semester_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "attendance_adjustments" DROP CONSTRAINT "FK_att_adj_student_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_att_adjustments_effective_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_att_adjustments_subject_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_att_adjustments_student_ps"`,
    );
    await queryRunner.query(`DROP TABLE "attendance_adjustments"`);

    await queryRunner.query(
      `ALTER TABLE "student_subject_attendance" DROP CONSTRAINT "FK_ssa_subject_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_attendance" DROP CONSTRAINT "FK_ssa_programme_semester_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "student_subject_attendance" DROP CONSTRAINT "FK_ssa_student_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_ssa_subject_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ssa_student_id"`);
    await queryRunner.query(`DROP TABLE "student_subject_attendance"`);

    await queryRunner.query(
      `ALTER TABLE "class_session_attendance" DROP CONSTRAINT "FK_csa_marked_by_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_session_attendance" DROP CONSTRAINT "FK_csa_student_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_session_attendance" DROP CONSTRAINT "FK_csa_class_session_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_class_session_attendance_class_session_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_class_session_attendance_student_id"`,
    );
    await queryRunner.query(`DROP TABLE "class_session_attendance"`);

    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_rescheduled_to_session_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_effective_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_scheduled_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_subject_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_pss_option_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_pss_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_timetable_entry_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_timetable_period_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_attendance_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "class_sessions" DROP CONSTRAINT "FK_class_sessions_programme_semester_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_class_sessions_key"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_class_sessions_timetable_entry_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_class_sessions_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_class_sessions_subject_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_class_sessions_teacher_date"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_class_sessions_ps_date"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_class_sessions_group_date"`,
    );
    await queryRunner.query(`DROP TABLE "class_sessions"`);

    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "CHK_academic_holidays_end_date_order"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "CHK_academic_holidays_declarer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "CHK_academic_holidays_scope_fks"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "FK_academic_holidays_declared_by_admin_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "FK_academic_holidays_declared_by_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "FK_academic_holidays_attendance_group_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "academic_holidays" DROP CONSTRAINT "FK_academic_holidays_programme_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_academic_holidays_attendance_group_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_academic_holidays_programme_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_academic_holidays_date"`);
    await queryRunner.query(`DROP TABLE "academic_holidays"`);

    await queryRunner.query(
      `ALTER TABLE "programme_semester_subjects" DROP COLUMN "cohort_scope"`,
    );
  }
}
