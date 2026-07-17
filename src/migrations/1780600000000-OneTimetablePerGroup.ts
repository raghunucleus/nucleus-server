import { MigrationInterface, QueryRunner } from 'typeorm';

// Pivot: drop the multi-revision timetable model in favour of one timetable
// per (programme_semester, attendance_group). Schedule edits become a
// per-week manual publish action instead of an effective-date-driven roll.
//
// Steps:
//   1. Deduplicate timetables — keep the most recently updated row per
//      (ps, group), delete older ones. Their child rows (periods, courses,
//      entries, course faculty) cascade. Existing class_sessions point at
//      timetable_entries via ON DELETE SET NULL, so attendance history
//      survives but loses the cell pointer.
//   2. Add UNIQUE(programme_semester_id, attendance_group_id).
//   3. Drop columns whose semantics changed:
//        effective_from / effective_to — the timetable is no longer
//          date-scoped; the semester's planned dates are the only window.
//        status — draft/published/archived no longer apply; a timetable
//          simply exists. "Publish a week" is the new mutating action,
//          tracked by class_sessions rows.
export class OneTimetablePerGroup1780600000000 implements MigrationInterface {
  name = 'OneTimetablePerGroup1780600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Deduplicate. Anything past the first row per (ps, group)
    //    ordered by updated_at DESC gets deleted. Cascade handles
    //    periods/courses/entries; class_sessions.timetable_entry_id
    //    is set null by its FK.
    await queryRunner.query(`
            WITH ranked AS (
              SELECT
                id,
                ROW_NUMBER() OVER (
                  PARTITION BY programme_semester_id, attendance_group_id
                  ORDER BY updated_at DESC, id DESC
                ) AS rn
              FROM "timetables"
            )
            DELETE FROM "timetables"
            WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        `);

    // 2. Enforce one-per-group going forward.
    await queryRunner.query(
      `ALTER TABLE "timetables" ADD CONSTRAINT "UQ_timetables_ps_group" UNIQUE ("programme_semester_id", "attendance_group_id")`,
    );

    // 3. Drop obsolete columns.
    await queryRunner.query(
      `ALTER TABLE "timetables" DROP COLUMN "effective_from"`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetables" DROP COLUMN "effective_to"`,
    );
    await queryRunner.query(`ALTER TABLE "timetables" DROP COLUMN "status"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "timetables" ADD "status" character varying(16) NOT NULL DEFAULT 'draft'`,
    );
    // The previous schema had non-null effective_from. We can't restore
    // the real values; fall back to today() so the column shape matches.
    // Down-migrations after a destructive forward are inherently lossy.
    await queryRunner.query(`ALTER TABLE "timetables" ADD "effective_to" date`);
    await queryRunner.query(
      `ALTER TABLE "timetables" ADD "effective_from" date NOT NULL DEFAULT CURRENT_DATE`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetables" ALTER COLUMN "effective_from" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "timetables" DROP CONSTRAINT "UQ_timetables_ps_group"`,
    );
  }
}
