import { MigrationInterface, QueryRunner } from 'typeorm';

// One-time backfill of the system-derived student-profile columns added by
// AddStudentProfileFieldsToStudents:
//  - pass_out_year   = admission_years.year + degrees.duration_years (lateral
//                      entrants graduate with their batch — no +1)
//  - ug_cgpa /
//    current_backlogs = mirrored from the cached student_cgpa aggregates
//  - backlog_history  = true where ANY attempt (not just is_best) has an F
// Going forward these are maintained by the admin students service
// (pass_out_year) and ExamMarksService.commitUpload (the other three).
export class BackfillStudentAcademicAggregates1793300000000 implements MigrationInterface {
  name = 'BackfillStudentAcademicAggregates1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "students" s
       SET "pass_out_year" = ay."year" + d."duration_years"
       FROM "admission_years" ay, "programmes" p, "degrees" d
       WHERE ay."id" = s."admission_year_id"
         AND p."id" = s."programme_id"
         AND d."id" = p."degree_id"
         AND d."duration_years" IS NOT NULL`,
    );

    await queryRunner.query(
      `UPDATE "students" s
       SET "ug_cgpa" = c."cgpa",
           "current_backlogs" = c."backlog_count"
       FROM "student_cgpa" c
       WHERE c."student_id" = s."id"`,
    );

    await queryRunner.query(
      `UPDATE "students" s
       SET "backlog_history" = true
       WHERE EXISTS (
         SELECT 1 FROM "student_exam_results" r
         WHERE r."student_id" = s."id" AND r."grade" = 'F'
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverting the schema migration drops the columns; resetting the values
    // here keeps a standalone revert of just this migration coherent.
    await queryRunner.query(
      `UPDATE "students"
       SET "pass_out_year" = NULL,
           "ug_cgpa" = NULL,
           "current_backlogs" = NULL,
           "backlog_history" = false`,
    );
  }
}
