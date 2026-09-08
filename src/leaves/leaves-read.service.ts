import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  EFFECTIVE_LEAVE_STATUSES,
  StudentLeave,
} from './entities/student-leave.entity';

export interface EffectiveLeaveRef {
  leave_id: number;
  leave_type: string;
}

/**
 * `'approved','cancel_requested'` as a SQL literal list, for the handful of
 * raw `EXISTS` subqueries that can't bind an array parameter. Derived from the
 * constant so the two can't drift.
 */
export const EFFECTIVE_LEAVE_STATUS_SQL = EFFECTIVE_LEAVE_STATUSES.map(
  (s) => `'${s}'`,
).join(',');

/**
 * Does a leave cover a given class session? Every caller needs the same two
 * clauses and they are easy to get subtly wrong, so they live here.
 *
 * A session has no clock time of its own: it anchors at a period and runs for
 * `span` consecutive periods, so its real window is the anchor's `start_time`
 * through the end of the period at `position + span - 1` (a lab). `tp_end` is
 * LEFT joined, hence the COALESCE.
 *
 * The overlap is half-open — a leave ending at 10:40 does NOT cover a class
 * starting at 10:40 — and a full-day leave (`from_time IS NULL`) covers
 * everything on its dates. Cancelled sessions are never covered: the class did
 * not happen, so there is nothing to sanction.
 *
 * Assumes the caller's aliases: `sl` student_leaves, `cs` class_sessions,
 * `tp` the anchor period, `tp_end` the span's last period.
 */
export function leaveCoversSessionSql(
  sl = 'sl',
  cs = 'cs',
  tp = 'tp',
  tpEnd = 'tp_end',
): string {
  return `${cs}.session_date BETWEEN ${sl}.from_date AND ${sl}.to_date
    AND ${cs}.status <> 'cancelled'
    AND (
      ${sl}.from_time IS NULL
      OR (${tp}.start_time < ${sl}.to_time
          AND COALESCE(${tpEnd}.end_time, ${tp}.end_time) > ${sl}.from_time)
    )`;
}

/**
 * "Who is on leave for class session X?" — the one question attendance asks of
 * the leaves domain. Read-only and tiny so the marking service and the teacher
 * roster can depend on it without pulling in the student leaves module (which
 * imports the requests framework). Accepts an optional `tx` so the marking
 * transaction sees the same snapshot it writes against.
 *
 * Keyed on the session rather than its date because a partial-day leave covers
 * only the periods inside its window — resolving that needs the session's bell
 * times, so the join lives here instead of in every caller.
 *
 * "Effective" = status in {@link EFFECTIVE_LEAVE_STATUSES}: an approved leave,
 * including one whose cancellation is still pending.
 */
@Injectable()
export class LeavesReadService {
  constructor(
    @InjectRepository(StudentLeave)
    private readonly leaves: Repository<StudentLeave>,
  ) {}

  /** Ids (from `studentIds`) with an effective leave covering `sessionId`. */
  async onLeaveStudentIds(
    studentIds: number[],
    sessionId: number,
    tx?: EntityManager,
  ): Promise<Set<number>> {
    if (studentIds.length === 0) return new Set();
    const repo = tx ? tx.getRepository(StudentLeave) : this.leaves;
    const rows = await this.coveringQuery(repo, studentIds, sessionId)
      .select('DISTINCT sl.student_id', 'student_id')
      .getRawMany<{ student_id: number | string }>();
    return new Set(rows.map((r) => Number(r.student_id)));
  }

  /**
   * Same question with the leave's identity attached — for the roster badge
   * ("On leave · Sick Leave"). One entry per student; overlapping effective
   * leaves are prevented at application time, so "first wins" is moot.
   */
  async effectiveLeavesOn(
    studentIds: number[],
    sessionId: number,
    tx?: EntityManager,
  ): Promise<Map<number, EffectiveLeaveRef>> {
    const out = new Map<number, EffectiveLeaveRef>();
    if (studentIds.length === 0) return out;
    const repo = tx ? tx.getRepository(StudentLeave) : this.leaves;
    const rows = await this.coveringQuery(repo, studentIds, sessionId)
      .innerJoin('sl.leave_type', 'lt')
      .select('sl.student_id', 'student_id')
      .addSelect('sl.id', 'leave_id')
      .addSelect('lt.name', 'leave_type')
      .orderBy('sl.id', 'ASC')
      .getRawMany<{
        student_id: number | string;
        leave_id: number | string;
        leave_type: string;
      }>();
    for (const r of rows) {
      const sid = Number(r.student_id);
      if (!out.has(sid)) {
        out.set(sid, {
          leave_id: Number(r.leave_id),
          leave_type: r.leave_type,
        });
      }
    }
    return out;
  }

  /**
   * Effective leaves for these students that cover this session — the shared
   * skeleton. The session and its period run are joined in so the partial-day
   * window can be compared against real bell times.
   */
  private coveringQuery(
    repo: Repository<StudentLeave>,
    studentIds: number[],
    sessionId: number,
  ) {
    return repo
      .createQueryBuilder('sl')
      .innerJoin('class_sessions', 'cs', 'cs.id = :sessionId', { sessionId })
      .innerJoin('timetable_periods', 'tp', 'tp.id = cs.timetable_period_id')
      .leftJoin(
        'timetable_periods',
        'tp_end',
        'tp_end.timetable_id = tp.timetable_id AND tp_end.position = tp.position + cs.span - 1',
      )
      .where('sl.student_id IN (:...ids)', { ids: studentIds })
      .andWhere('sl.status IN (:...statuses)', {
        statuses: [...EFFECTIVE_LEAVE_STATUSES],
      })
      .andWhere(leaveCoversSessionSql());
  }
}
