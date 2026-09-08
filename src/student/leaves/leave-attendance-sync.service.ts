import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ClassSessionAuditLog } from '../../admin/entities/class-session-audit-log.entity';
import type { LeaveImpact } from './leave-payloads';

type FlipStatus = 'absent' | 'leave';

/**
 * The one place leave decisions touch attendance rows. Approving a leave
 * after the fact flips the student's `absent` marks in range to `leave`;
 * approving a cancellation flips them back. Only `completed` sessions and only
 * the two statuses named — present/late are never rewritten (the student was
 * there), and nothing is done to unmarked sessions (marking handles those live
 * via LeavesReadService). Neither flip changes held/attended counts, so the
 * rollup is deliberately NOT recomputed.
 *
 * This is a retro-repair for sessions already marked while the request sat in
 * the queue, NOT the mechanism — which is why a class cancelled or re-opened
 * after approval needs nothing here. Cancelled sessions carry no attendance
 * rows at all (`ClassSessionsService.cancel` refuses a `completed` session, and
 * rows are only written at mark time), so the `completed` filter cannot miss
 * one; a re-opened class picks the leave up live when it is finally marked.
 *
 * A partial-day leave flips only the sessions whose period run overlaps its
 * window, so an afternoon class stays `absent` when the student took the
 * morning off.
 */
@Injectable()
export class LeaveAttendanceSyncService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Flip `from` → `to` for one student's marks on completed sessions in the
   * inclusive date range, inside the caller's transaction, and write one
   * `leave_sync` audit row per affected session. Returns the session ids.
   * The teacher's `marked_at` / `marked_by` stamps are kept — the mark still
   * records who took attendance; the audit row records who changed it.
   */
  async flip(
    tx: EntityManager,
    opts: {
      studentId: number;
      from: string;
      to: string;
      /** Partial-day window; both null on a full-day leave. */
      fromTime: string | null;
      toTime: string | null;
      fromStatus: FlipStatus;
      toStatus: FlipStatus;
      reason: string;
      actorEmployeeId: number;
    },
  ): Promise<number[]> {
    // TypeORM's Postgres runner returns `[rows, affectedCount]` for
    // INSERT/UPDATE/DELETE (only SELECT yields the bare row array), so the
    // RETURNING rows are the first element — treating the tuple itself as the
    // rows would turn `[[], 0]` into two phantom sessions.
    const [rows] = await tx.query<
      [{ class_session_id: number | string }[], number]
    >(
      `UPDATE "class_session_attendance" csa
          SET "status" = $4, "updated_at" = NOW()
         FROM "class_sessions" cs
         JOIN "timetable_periods" tp ON tp.id = cs.timetable_period_id
         LEFT JOIN "timetable_periods" tp_end
           ON tp_end.timetable_id = tp.timetable_id
          AND tp_end.position = tp.position + cs.span - 1
        WHERE cs."id" = csa."class_session_id"
          AND csa."student_id" = $1
          AND csa."status" = $5
          AND cs."status" = 'completed'
          AND cs."session_date" BETWEEN $2 AND $3
          AND (
            $6::time IS NULL
            OR (tp.start_time < $7::time
                AND COALESCE(tp_end.end_time, tp.end_time) > $6::time)
          )
      RETURNING csa."class_session_id"`,
      [
        opts.studentId,
        opts.from,
        opts.to,
        opts.toStatus,
        opts.fromStatus,
        opts.fromTime,
        opts.toTime,
      ],
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const sessionIds = rows.map((r) => Number(r.class_session_id));
    const audit = tx.getRepository(ClassSessionAuditLog);
    await audit.save(
      sessionIds.map((sessionId) =>
        audit.create({
          class_session_id: sessionId,
          action: 'leave_sync',
          before: { student_id: opts.studentId, status: opts.fromStatus },
          after: { student_id: opts.studentId, status: opts.toStatus },
          reason: opts.reason,
          performed_by_employee_id: opts.actorEmployeeId,
        }),
      ),
    );
    return sessionIds;
  }

  /**
   * What a decision on this range would touch — shown to the approver. Marked
   * sessions come straight from the student's attendance rows; upcoming and
   * cancelled ones use the same group/elective scoping as the student
   * timetable (see StudentPortalService.week) because a session with no
   * attendance row can't be found through one.
   *
   * Cancelled classes are counted and shown but never acted on: they are not
   * held, so they neither flip nor affect the percentage. The approver needs to
   * see them because a partial-day leave may name periods that are already
   * cancelled, which would otherwise look like an empty request.
   */
  async impactFor(
    studentId: number,
    from: string,
    to: string,
    fromTime: string | null,
    toTime: string | null,
  ): Promise<LeaveImpact> {
    const [marked] = await this.dataSource.query<
      Array<{
        absent_sessions: number | string;
        leave_sessions: number | string;
        attended_sessions: number | string;
      }>
    >(
      `SELECT
         COUNT(*) FILTER (WHERE csa."status" = 'absent')::int AS absent_sessions,
         COUNT(*) FILTER (WHERE csa."status" = 'leave')::int AS leave_sessions,
         COUNT(*) FILTER (WHERE csa."status" IN ('present','late'))::int AS attended_sessions
       FROM "class_session_attendance" csa
       JOIN "class_sessions" cs ON cs."id" = csa."class_session_id"
       JOIN "timetable_periods" tp ON tp.id = cs.timetable_period_id
       LEFT JOIN "timetable_periods" tp_end
         ON tp_end.timetable_id = tp.timetable_id
        AND tp_end.position = tp.position + cs.span - 1
       WHERE csa."student_id" = $1
         AND cs."status" = 'completed'
         AND cs."session_date" BETWEEN $2 AND $3
         AND (
           $4::time IS NULL
           OR (tp.start_time < $5::time
               AND COALESCE(tp_end.end_time, tp.end_time) > $4::time)
         )`,
      [studentId, from, to, fromTime, toTime],
    );
    const [upcoming] = await this.dataSource.query<
      Array<{
        upcoming_sessions: number | string;
        cancelled_sessions: number | string;
      }>
    >(
      `WITH my_group AS (
         SELECT attendance_group_id FROM "student_groups" WHERE student_id = $1
       ),
       my_electives AS (
         SELECT pos.programme_semester_subject_option_id AS option_id, pos.employee_id
         FROM "programme_semester_subject_option_students" pos
         WHERE pos.student_id = $1
       )
       SELECT
         COUNT(*) FILTER (WHERE cs."status" = 'scheduled')::int AS upcoming_sessions,
         COUNT(*) FILTER (WHERE cs."status" = 'cancelled')::int AS cancelled_sessions
       FROM "class_sessions" cs
       JOIN "timetable_periods" tp ON tp.id = cs.timetable_period_id
       LEFT JOIN "timetable_periods" tp_end
         ON tp_end.timetable_id = tp.timetable_id
        AND tp_end.position = tp.position + cs.span - 1
       WHERE cs."session_date" BETWEEN $2 AND $3
         AND cs."status" IN ('scheduled', 'cancelled')
         AND (
           $4::time IS NULL
           OR (tp.start_time < $5::time
               AND COALESCE(tp_end.end_time, tp.end_time) > $4::time)
         )
         AND (
           (cs.programme_semester_subject_option_id IS NULL
            AND cs.attendance_group_id = (SELECT attendance_group_id FROM my_group))
           OR
           (cs.programme_semester_subject_option_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM my_electives me
              WHERE me.option_id = cs.programme_semester_subject_option_id
                AND me.employee_id = cs.scheduled_employee_id
            ))
         )`,
      [studentId, from, to, fromTime, toTime],
    );
    return {
      absent_sessions: Number(marked?.absent_sessions ?? 0),
      leave_sessions: Number(marked?.leave_sessions ?? 0),
      attended_sessions: Number(marked?.attended_sessions ?? 0),
      upcoming_sessions: Number(upcoming?.upcoming_sessions ?? 0),
      cancelled_sessions: Number(upcoming?.cancelled_sessions ?? 0),
    };
  }
}
