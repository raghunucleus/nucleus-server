import { MigrationInterface, QueryRunner } from 'typeorm';

// Attendance rollup integrity fix.
//
// Background: student_subject_attendance.{attended_count, held_count} used to
// be maintained by incremental +deltas at mark/amend time. When a student's
// roster membership changed between a session's first mark and a later amend,
// the amend bumped `attended` without a matching `held`, so the cached counts
// drifted out of sync with the underlying class_session_attendance rows —
// producing impossible >100% attendance (e.g. roll 15981A04C4 showing 150%).
//
// The marking service now recomputes the rollup directly from
// class_session_attendance (the complete, authoritative per-session record),
// where held = COUNT(rows on completed sessions) and attended = COUNT(present/
// late rows). attended can never exceed held by construction.
//
// This migration:
//   1. Rebuilds every rollup row from class_session_attendance ground truth,
//      repairing all historical drift in one pass.
//   2. Zeroes any stale rollup row no longer backed by a completed session
//      (e.g. a completed session was later deleted, cascading its attendance
//      rows away without decrementing the cache).
//   3. Adds CHECK (attended_count <= held_count) so the invariant can never be
//      violated again. Adjustments (OD / medical) live in
//      attendance_adjustments and are folded in at read time — they are NOT
//      stored on this row — so the stored rollup is always attended <= held.
export class RecomputeAttendanceRollups1781800000000
  implements MigrationInterface
{
  name = 'RecomputeAttendanceRollups1781800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Rebuild every rollup row from class_session_attendance ground truth.
    await queryRunner.query(`
      INSERT INTO "student_subject_attendance" (
        "student_id", "programme_semester_id", "subject_id",
        "attended_count", "held_count", "last_session_at"
      )
      SELECT
        csa."student_id",
        cs."programme_semester_id",
        cs."subject_id",
        COUNT(*) FILTER (WHERE csa."status" IN ('present','late'))::int,
        COUNT(*)::int,
        MAX(csa."marked_at")
      FROM "class_session_attendance" csa
      JOIN "class_sessions" cs ON cs."id" = csa."class_session_id"
      WHERE cs."status" = 'completed'
      GROUP BY csa."student_id", cs."programme_semester_id", cs."subject_id"
      ON CONFLICT ("student_id", "programme_semester_id", "subject_id")
      DO UPDATE SET
        attended_count  = EXCLUDED.attended_count,
        held_count      = EXCLUDED.held_count,
        last_session_at = EXCLUDED.last_session_at,
        updated_at      = NOW()
    `);

    // 2. Zero out any rollup row with no completed-session attendance backing
    // it, keeping the table a strict projection (0 <= 0 satisfies the check).
    await queryRunner.query(`
      UPDATE "student_subject_attendance" ssa
      SET attended_count = 0, held_count = 0, updated_at = NOW()
      WHERE NOT EXISTS (
        SELECT 1
        FROM "class_session_attendance" csa
        JOIN "class_sessions" cs ON cs."id" = csa."class_session_id"
        WHERE csa."student_id" = ssa."student_id"
          AND cs."programme_semester_id" = ssa."programme_semester_id"
          AND cs."subject_id" = ssa."subject_id"
          AND cs."status" = 'completed'
      )
    `);

    // 3. Enforce the invariant for good.
    await queryRunner.query(`
      ALTER TABLE "student_subject_attendance"
      ADD CONSTRAINT "CHK_ssa_attended_le_held"
      CHECK ("attended_count" <= "held_count")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "student_subject_attendance"
      DROP CONSTRAINT "CHK_ssa_attended_le_held"
    `);
    // The ground-truth recompute is intentionally not reversed — the previous
    // (drifted) counts were incorrect and are not worth restoring.
  }
}
