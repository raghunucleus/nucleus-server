import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the extended student-profile columns (personal names, personal email,
// academic performance, parent/guardian contacts, home address, government IDs,
// entrance exam, gap, 10th/12th/diploma history, placement flags).
//
// Everything is nullable (or defaulted) on purpose: these fields are filled in
// AFTER onboarding — by the student through the approval/OTP flows or by an
// admin — so the existing create + bulk-upload paths (9 fields) keep working
// unchanged. Columns that already existed (display_name, gender, entry_type,
// dob, blood_group, abc_id, mobile_number, email, photo_key) are deliberately
// absent from this migration.
//
// ADD COLUMN IF NOT EXISTS keeps a partially-applied hand-run re-runnable.
export class AddStudentProfileFieldsToStudents1793000000000 implements MigrationInterface {
  name = 'AddStudentProfileFieldsToStudents1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "students"
        ADD COLUMN IF NOT EXISTS "first_name" character varying(64),
        ADD COLUMN IF NOT EXISTS "middle_name" character varying(64),
        ADD COLUMN IF NOT EXISTS "last_name" character varying(64),
        ADD COLUMN IF NOT EXISTS "personal_email" character varying(255),
        ADD COLUMN IF NOT EXISTS "personal_email_pending" character varying(255),
        ADD COLUMN IF NOT EXISTS "pass_out_year" integer,
        ADD COLUMN IF NOT EXISTS "tenth_percentage" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "twelfth_percentage" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "diploma_percentage" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "ug_cgpa" numeric(4,2),
        ADD COLUMN IF NOT EXISTS "current_backlogs" integer,
        ADD COLUMN IF NOT EXISTS "backlog_history" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "resume_key" text,
        ADD COLUMN IF NOT EXISTS "resume_uploaded_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "parent_name" character varying(128),
        ADD COLUMN IF NOT EXISTS "parent_mobile" character varying(16),
        ADD COLUMN IF NOT EXISTS "parent_email" character varying(255),
        ADD COLUMN IF NOT EXISTS "guardian_name" character varying(128),
        ADD COLUMN IF NOT EXISTS "guardian_mobile" character varying(16),
        ADD COLUMN IF NOT EXISTS "guardian_email" character varying(255),
        ADD COLUMN IF NOT EXISTS "home_address" text,
        ADD COLUMN IF NOT EXISTS "home_district_id" integer,
        ADD COLUMN IF NOT EXISTS "home_pincode" character varying(6),
        ADD COLUMN IF NOT EXISTS "home_state_id" integer,
        ADD COLUMN IF NOT EXISTS "home_country_id" integer,
        ADD COLUMN IF NOT EXISTS "aadhaar_number" character varying(12),
        ADD COLUMN IF NOT EXISTS "pan_number" character varying(10),
        ADD COLUMN IF NOT EXISTS "entrance_exam_na" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "entrance_exam_rank" integer,
        ADD COLUMN IF NOT EXISTS "entrance_exam_id" integer,
        ADD COLUMN IF NOT EXISTS "entrance_exam_year" smallint,
        ADD COLUMN IF NOT EXISTS "year_of_gap" smallint,
        ADD COLUMN IF NOT EXISTS "reason_of_gap" text,
        ADD COLUMN IF NOT EXISTS "tenth_board_id" integer,
        ADD COLUMN IF NOT EXISTS "tenth_institution" character varying(255),
        ADD COLUMN IF NOT EXISTS "tenth_year_of_pass" smallint,
        ADD COLUMN IF NOT EXISTS "tenth_state_id" integer,
        ADD COLUMN IF NOT EXISTS "twelfth_board_id" integer,
        ADD COLUMN IF NOT EXISTS "twelfth_institution" character varying(255),
        ADD COLUMN IF NOT EXISTS "twelfth_year_of_pass" smallint,
        ADD COLUMN IF NOT EXISTS "twelfth_state_id" integer,
        ADD COLUMN IF NOT EXISTS "diploma_board_id" integer,
        ADD COLUMN IF NOT EXISTS "diploma_institution" character varying(255),
        ADD COLUMN IF NOT EXISTS "diploma_year_of_pass" smallint,
        ADD COLUMN IF NOT EXISTS "diploma_specialization" character varying(128),
        ADD COLUMN IF NOT EXISTS "diploma_state_id" integer,
        ADD COLUMN IF NOT EXISTS "allowed_by_dept_for_placements" boolean,
        ADD COLUMN IF NOT EXISTS "interested_in_placements_self" boolean`,
    );

    // Aadhaar is unique when present — Postgres UNIQUE allows multiple NULLs
    // (same pattern as abc_id).
    await queryRunner.query(
      `ALTER TABLE "students" ADD CONSTRAINT "UQ_students_aadhaar_number" UNIQUE ("aadhaar_number")`,
    );

    // Placements will filter cohorts by pass-out year.
    await queryRunner.query(
      `CREATE INDEX "IDX_students_pass_out_year" ON "students" ("pass_out_year")`,
    );

    // Lookup FKs — RESTRICT everywhere: master rows referenced by a student can
    // be deactivated but never deleted (masters have no DELETE route anyway).
    const fks: Array<[string, string]> = [
      ['home_district_id', 'districts'],
      ['home_state_id', 'states'],
      ['home_country_id', 'countries'],
      ['entrance_exam_id', 'entrance_exams'],
      ['tenth_board_id', 'school_boards_x'],
      ['tenth_state_id', 'states'],
      ['twelfth_board_id', 'school_boards_xii'],
      ['twelfth_state_id', 'states'],
      ['diploma_board_id', 'diploma_boards'],
      ['diploma_state_id', 'states'],
    ];
    for (const [col, table] of fks) {
      await queryRunner.query(
        `ALTER TABLE "students" ADD CONSTRAINT "FK_students_${col}" FOREIGN KEY ("${col}") REFERENCES "${table}"("id") ON DELETE RESTRICT`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const fkCols = [
      'home_district_id',
      'home_state_id',
      'home_country_id',
      'entrance_exam_id',
      'tenth_board_id',
      'tenth_state_id',
      'twelfth_board_id',
      'twelfth_state_id',
      'diploma_board_id',
      'diploma_state_id',
    ];
    for (const col of fkCols) {
      await queryRunner.query(
        `ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "FK_students_${col}"`,
      );
    }
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_students_pass_out_year"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "UQ_students_aadhaar_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "students"
        DROP COLUMN IF EXISTS "first_name",
        DROP COLUMN IF EXISTS "middle_name",
        DROP COLUMN IF EXISTS "last_name",
        DROP COLUMN IF EXISTS "personal_email",
        DROP COLUMN IF EXISTS "personal_email_pending",
        DROP COLUMN IF EXISTS "pass_out_year",
        DROP COLUMN IF EXISTS "tenth_percentage",
        DROP COLUMN IF EXISTS "twelfth_percentage",
        DROP COLUMN IF EXISTS "diploma_percentage",
        DROP COLUMN IF EXISTS "ug_cgpa",
        DROP COLUMN IF EXISTS "current_backlogs",
        DROP COLUMN IF EXISTS "backlog_history",
        DROP COLUMN IF EXISTS "resume_key",
        DROP COLUMN IF EXISTS "resume_uploaded_at",
        DROP COLUMN IF EXISTS "parent_name",
        DROP COLUMN IF EXISTS "parent_mobile",
        DROP COLUMN IF EXISTS "parent_email",
        DROP COLUMN IF EXISTS "guardian_name",
        DROP COLUMN IF EXISTS "guardian_mobile",
        DROP COLUMN IF EXISTS "guardian_email",
        DROP COLUMN IF EXISTS "home_address",
        DROP COLUMN IF EXISTS "home_district_id",
        DROP COLUMN IF EXISTS "home_pincode",
        DROP COLUMN IF EXISTS "home_state_id",
        DROP COLUMN IF EXISTS "home_country_id",
        DROP COLUMN IF EXISTS "aadhaar_number",
        DROP COLUMN IF EXISTS "pan_number",
        DROP COLUMN IF EXISTS "entrance_exam_na",
        DROP COLUMN IF EXISTS "entrance_exam_rank",
        DROP COLUMN IF EXISTS "entrance_exam_id",
        DROP COLUMN IF EXISTS "entrance_exam_year",
        DROP COLUMN IF EXISTS "year_of_gap",
        DROP COLUMN IF EXISTS "reason_of_gap",
        DROP COLUMN IF EXISTS "tenth_board_id",
        DROP COLUMN IF EXISTS "tenth_institution",
        DROP COLUMN IF EXISTS "tenth_year_of_pass",
        DROP COLUMN IF EXISTS "tenth_state_id",
        DROP COLUMN IF EXISTS "twelfth_board_id",
        DROP COLUMN IF EXISTS "twelfth_institution",
        DROP COLUMN IF EXISTS "twelfth_year_of_pass",
        DROP COLUMN IF EXISTS "twelfth_state_id",
        DROP COLUMN IF EXISTS "diploma_board_id",
        DROP COLUMN IF EXISTS "diploma_institution",
        DROP COLUMN IF EXISTS "diploma_year_of_pass",
        DROP COLUMN IF EXISTS "diploma_specialization",
        DROP COLUMN IF EXISTS "diploma_state_id",
        DROP COLUMN IF EXISTS "allowed_by_dept_for_placements",
        DROP COLUMN IF EXISTS "interested_in_placements_self"`,
    );
  }
}
