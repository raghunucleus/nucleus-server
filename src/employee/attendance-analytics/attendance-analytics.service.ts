import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AttendanceGroup } from '../../admin/entities/attendance-group.entity';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { pct } from '../../admin/sessions/student-attendance-query.service';
import {
  InchargeScheduleService,
  type InchargeGroupSummary,
} from '../attendance-incharge/incharge-schedule.service';
import {
  MARKS_CTE,
  ROSTER_CTE,
  SCOPED_SESSIONS_CTE,
} from './attendance-analytics.sql';

/** Campus-local time zone. `CURRENT_DATE` is NOT usable here: no DB timezone is
 *  configured, so between 00:00 and 05:30 IST Postgres would still say
 *  "yesterday" and every unmarked session would flip between overdue and
 *  upcoming. Always pass `today` from Node. */
const DISPLAY_TZ = 'Asia/Kolkata';

/** The bands every client colours by. Server-owned so web and a future mobile
 *  screen can't drift apart. `min` is inclusive, `max` exclusive. */
export const ATTENDANCE_BANDS = [
  { key: 'critical', label: 'Below 50%', min: 0, max: 50 },
  { key: 'low', label: '50–65%', min: 50, max: 65 },
  { key: 'condonation', label: '65–75%', min: 65, max: 75 },
  { key: 'ok', label: '75–85%', min: 75, max: 85 },
  { key: 'good', label: '85% and above', min: 85, max: 101 },
] as const;

/** The threshold a student must clear to sit exams, and the condonation floor
 *  below it. Compared against the RAW ratio, never the rounded percentage. */
export const DEFAULT_THRESHOLD = 75;
export const CONDONATION_THRESHOLD = 65;

export type AnalyticsBasis = 'rollup' | 'sessions';

/** The day grid is the only payload that grows as students × days. */
const MATRIX_MAX_DAYS = 60;

// --- shared SQL ------------------------------------------------------------
//
// The three CTEs live in ./attendance-analytics.sql.ts so the Insights
// attendance screen can build on the same base. Every query below is written
// against the same four positional parameters:
//   $1 int[] group_ids, $2 int[] programme_semester_ids, $3 from, $4 to
// Endpoints that need more append from $5 onward.

/**
 * What every query runs against. The incharge surface always holds exactly
 * one group and one semester here; the Insights surface holds every group of
 * every batch in the caller's RBAC scope, with one semester per batch. The
 * arrays are the only difference — every method below is shared.
 */
export interface AnalyticsScope {
  groupIds: number[];
  /** One programme semester per batch — never two of the same batch. */
  psIds: number[];
  /** No semester in scope is still `ongoing`, so an unmarked backlog can never
   *  be cleared and is reported as history rather than a to-do. */
  locked: boolean;
  /** Null in rollup mode — the whole semester, however far it stretches. */
  from: string | null;
  to: string | null;
  basis: AnalyticsBasis;
  today: string;
  rosterIds: number[];
}

export interface RosterRow {
  student_id: number;
  roll_no: string;
  display_name: string;
}

/**
 * Read-only attendance analytics for one attendance group.
 *
 * ## The two bases — why this isn't one query
 *
 * `student_subject_attendance` is a per (student × semester × subject) rollup
 * with no date dimension. So:
 *
 *   - **`basis: 'rollup'`** (no date range) reads that table plus
 *     `attendance_adjustments`, replicating `StudentAttendanceQueryService`
 *     exactly. The figures are then IDENTICAL to the student's own dashboard by
 *     construction — which matters, because this screen produces the defaulter
 *     list students contest. It is also the fastest path (`UQ_ssa_student_ps_subject`).
 *   - **`basis: 'sessions'`** (date range supplied) scans the marked sessions in
 *     the window. Adjustments are EXCLUDED: a delta carries an `effective_date`
 *     but no session, so it can't be attributed to a day.
 *
 * Do not "unify" these by always scanning sessions. `programme_semesters`'
 * planned dates are nullable and ad-hoc sessions are inserted outside them, so
 * a date-bounded scan can silently miss sessions the rollup counted.
 *
 * ## Session inventory vs attendance math
 *
 * These are different question and use different base sets:
 *
 *   - **`marks`** (a student's attendance rows) answers "what percentage?".
 *     Scoped by the group's ROSTER, not by `cs.attendance_group_id`, because a
 *     cross-group elective session carries `attendance_group_id IS NULL` and
 *     filtering on the column would drop it — see `RosterService.forSession`.
 *   - **`scoped_sessions`** (the sessions themselves) answers "what was
 *     scheduled / marked / missed?". It must resolve cross-group electives
 *     through `programme_semester_subject_option_students`, NOT through
 *     `class_session_attendance` — an unmarked session has zero attendance rows
 *     by definition, and unmarked sessions are the whole point of that query.
 *
 * Never count sessions out of `marks`: a student who transferred in carries
 * their old group's rows, so `COUNT(DISTINCT session_id)` there is not "sessions
 * this group held".
 *
 * ## Known limitations, deliberately surfaced rather than hidden
 *
 *   - **Transfers.** `student_groups` holds current membership only, and
 *     `student_group_history` — though it exists and is effective-dated — has no
 *     writer anywhere in the repo, so it is empty. A student who moves groups
 *     mid-semester takes their whole semester with them. `joined_group_estimate`
 *     lets the UI grey out pre-arrival cells.
 *   - **Duplicate elective sessions.** `UQ_class_sessions_key` includes
 *     `timetable_period_id`, which is per-timetable, so two groups publishing the
 *     same cross-group elective slot each insert their own copy. `warnings`
 *     reports the count instead of silently double-counting. The durable fix is
 *     in the seeder, not here.
 */
@Injectable()
export class AttendanceAnalyticsService {
  constructor(
    @InjectRepository(AttendanceGroup)
    private readonly groups: Repository<AttendanceGroup>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    private readonly incharge: InchargeScheduleService,
    private readonly dataSource: DataSource,
  ) {}

  // --- scope ---------------------------------------------------------------

  /**
   * Everything the pickers need in one round-trip: the groups the caller is
   * incharge of, and for each the programme semesters of its batch with a
   * default pre-selected.
   *
   * `listProgrammeSemesters` is called ONCE with no group filter and mapped in
   * JS — calling it per group would re-run `ownedGroupIds` and a fresh
   * programme_semesters query every time.
   */
  async scope(employeeId: number): Promise<{
    groups: Array<
      InchargeGroupSummary & {
        programme_semesters: SemesterSummary[];
        default_programme_semester_id: number | null;
      }
    >;
  }> {
    const groups = await this.incharge.listGroups(employeeId);
    if (groups.length === 0) return { groups: [] };

    const all = await this.incharge.listProgrammeSemesters(employeeId);
    const byBatch = new Map<string, SemesterSummary[]>();
    for (const ps of all) {
      const key = `${ps.programme_id}:${ps.admission_year_id}`;
      const list = byBatch.get(key) ?? [];
      list.push({
        id: ps.id,
        programme_id: ps.programme_id,
        admission_year_id: ps.admission_year_id,
        semester_id: ps.semester_id,
        status: ps.status,
        planned_start_date: ps.planned_start_date,
        planned_end_date: ps.planned_end_date,
        semester: {
          id: ps.semester.id,
          sem_number: ps.semester.sem_number,
          code: ps.semester.code,
        },
      });
      byBatch.set(key, list);
    }

    return {
      groups: groups.map((g) => {
        const rows = (
          byBatch.get(`${g.programme.id}:${g.admission_year.id}`) ?? []
        ).sort((a, b) => b.semester.sem_number - a.semester.sem_number);
        return {
          ...g,
          programme_semesters: rows,
          // Same precedence as StudentAttendanceQueryService.findCurrentPsId:
          // the ongoing semester, else the most recent one.
          default_programme_semester_id:
            rows.find((r) => r.status === 'ongoing')?.id ?? rows[0]?.id ?? null,
        };
      }),
    };
  }

  /**
   * The gate every endpoint runs first. Two independent checks — either one
   * missing is a cross-tenant read:
   *   1. the group is one the caller is incharge of;
   *   2. the semester belongs to that group's (programme, admission year) batch,
   *      so a valid-looking ps id from another batch can't be substituted.
   */
  async requireScope(
    employeeId: number,
    groupId: number,
    psId: number,
    from?: string,
    to?: string,
  ): Promise<AnalyticsScope> {
    const owned = await this.incharge.ownedGroupIds(employeeId);
    if (!owned.includes(groupId)) {
      throw new ForbiddenException(
        "You aren't the incharge of that attendance group.",
      );
    }
    const group = await this.groups.findOne({ where: { id: groupId } });
    const ps = await this.programmeSemesters.findOne({ where: { id: psId } });
    if (!group || !ps) {
      throw new NotFoundException('Group or semester not found');
    }
    if (
      ps.programme_id !== group.programme_id ||
      ps.admission_year_id !== group.admission_year_id
    ) {
      throw new ForbiddenException(
        "That programme semester doesn't match this group's batch.",
      );
    }
    return this.buildScope(
      [group.id],
      [ps.id],
      ps.status !== 'ongoing',
      from,
      to,
    );
  }

  /**
   * Assemble a scope from already-authorised group / semester sets. The
   * incharge path calls this after its ownership checks; the Insights surface
   * calls it after resolving the caller's RBAC scope. Authorisation is the
   * caller's job — this only shapes the object every query takes.
   */
  async buildScope(
    groupIds: number[],
    psIds: number[],
    locked: boolean,
    from?: string,
    to?: string,
  ): Promise<AnalyticsScope> {
    const roster = await this.roster(groupIds);
    return {
      groupIds,
      psIds,
      locked,
      from: from ?? null,
      to: to ?? null,
      basis: from && to ? 'sessions' : 'rollup',
      today: campusToday(),
      rosterIds: roster.map((r) => r.student_id),
    };
  }

  /** Active members of the groups, by display name. */
  async roster(groupIds: number[]): Promise<RosterRow[]> {
    return this.dataSource.query<RosterRow[]>(
      `SELECT s.id AS student_id, s.student_id AS roll_no, s.display_name
         FROM students s
         JOIN student_groups sg ON sg.student_id = s.id
        WHERE sg.attendance_group_id = ANY($1::int[]) AND s.is_active = TRUE
        ORDER BY s.display_name ASC`,
      [groupIds],
    );
  }

  // --- students ------------------------------------------------------------

  /**
   * One row per roster student with their overall and per-subject figures,
   * plus the fields that turn a defaulter list into an intervention list:
   * the current absent streak, how many more sessions clear the threshold, and
   * the best percentage still reachable.
   *
   * Powers BOTH the Students tab and the Defaulters tab — the threshold filter
   * runs client-side over `below_threshold`, which is computed here from the
   * raw ratio.
   */
  async students(s: AnalyticsScope): Promise<StudentsResult> {
    const roster = await this.roster(s.groupIds);
    if (roster.length === 0) {
      return { basis: s.basis, sessions_remaining: 0, rows: [] };
    }

    const perSubject =
      s.basis === 'rollup'
        ? await this.perSubjectFromRollup(s)
        : await this.perSubjectFromSessions(s);

    // Adjustments are semester-wide with no session to pin them to, so they
    // only apply on the rollup basis — a date-ranged view leaves them out.
    const [overallAdj, extras, remaining] = await Promise.all([
      s.basis === 'rollup'
        ? this.overallAdjustments(s)
        : Promise.resolve(
            new Map<number, { attended: number; held: number }>(),
          ),
      this.studentExtras(s),
      this.remainingSessions(s),
    ]);

    const byStudent = new Map<number, PerSubjectRow[]>();
    for (const row of perSubject) {
      const list = byStudent.get(row.student_id) ?? [];
      list.push(row);
      byStudent.set(row.student_id, list);
    }

    const rows: StudentRow[] = roster.map((r) => {
      const subjects = byStudent.get(r.student_id) ?? [];
      const adj = overallAdj.get(r.student_id);
      const attended =
        subjects.reduce((a, b) => a + b.attended, 0) + (adj?.attended ?? 0);
      const held = subjects.reduce((a, b) => a + b.held, 0) + (adj?.held ?? 0);
      const extra = extras.get(r.student_id);
      const p = pct(attended, held);
      return {
        ...r,
        attended,
        held,
        pct: p,
        band: bandFor(p),
        ...thresholds(attended, held),
        ...projection(attended, held, remaining),
        current_absent_streak: extra?.current_absent_streak ?? 0,
        joined_group_estimate: extra?.joined_group_estimate ?? null,
        per_subject: subjects.map((x) => ({
          ...x,
          pct: pct(x.attended, x.held),
          band: bandFor(pct(x.attended, x.held)),
          ...thresholds(x.attended, x.held),
        })),
      };
    });

    return { basis: s.basis, sessions_remaining: remaining, rows };
  }

  /**
   * One student's full detail: their per-subject figures and every session they
   * were marked on, newest first.
   *
   * `studentId` is bound to the group roster. Without that check the endpoint
   * is an IDOR — owning ONE group would let a caller read any student by id.
   * NotFound rather than Forbidden so the response doesn't confirm the id
   * exists somewhere else.
   */
  async studentDetail(
    s: AnalyticsScope,
    studentId: number,
  ): Promise<StudentDetailResult> {
    if (!s.rosterIds.includes(studentId)) {
      throw new NotFoundException('Student not found in this attendance group');
    }
    const all = await this.students(s);
    const row = all.rows.find((r) => r.student_id === studentId);
    if (!row) throw new NotFoundException('Student not found');

    const sessions = await this.dataSource.query<StudentSessionRow[]>(
      `${ROSTER_CTE},
       ${MARKS_CTE}
       SELECT m.session_id, m.session_date::text AS session_date, m.day_of_week,
              tp.position AS period_position, tp.label AS period_label,
              tp.start_time::text AS start_time, tp.end_time::text AS end_time,
              m.span, sub.id AS subject_id, sub.code AS subject_code,
              sub.name AS subject_name,
              (cs.programme_semester_subject_option_id IS NOT NULL) AS is_elective,
              emp.emp_display_name AS teacher_display_name,
              (cs.effective_employee_id IS DISTINCT FROM cs.scheduled_employee_id) AS is_substitute,
              m.status
         FROM marks m
         JOIN class_sessions cs ON cs.id = m.session_id
         JOIN timetable_periods tp ON tp.id = m.timetable_period_id
         JOIN subjects sub ON sub.id = m.subject_id
         LEFT JOIN employees emp ON emp.id = m.effective_employee_id
        WHERE m.student_id = $5
        ORDER BY m.session_date DESC, tp.position ASC`,
      [...this.baseParams(s), studentId],
    );

    return { basis: s.basis, student: row, sessions };
  }

  // --- subjects ------------------------------------------------------------

  /**
   * Per-subject rollup for the whole group, with the five weakest students in
   * each. The weakest list is a single window-function pass — one query per
   * subject would be an N+1 on a screen that renders every subject at once.
   */
  async subjects(s: AnalyticsScope): Promise<SubjectsResult> {
    const perSubject =
      s.basis === 'rollup'
        ? await this.perSubjectFromRollup(s)
        : await this.perSubjectFromSessions(s);

    const rosterById = new Map(
      (await this.roster(s.groupIds)).map((r) => [r.student_id, r]),
    );

    const agg = new Map<number, SubjectAgg>();
    for (const row of perSubject) {
      const hit = agg.get(row.subject_id) ?? {
        subject_id: row.subject_id,
        subject_code: row.subject_code,
        subject_name: row.subject_name,
        attended: 0,
        held: 0,
        students: [] as Array<{ student_id: number; a: number; h: number }>,
      };
      hit.attended += row.attended;
      hit.held += row.held;
      hit.students.push({
        student_id: row.student_id,
        a: row.attended,
        h: row.held,
      });
      agg.set(row.subject_id, hit);
    }

    const [inventory, teachers] = await Promise.all([
      this.sessionInventoryBySubject(s),
      this.teachersBySubject(s),
    ]);

    const rows: SubjectRow[] = [...agg.values()]
      .map((sub) => {
        const p = pct(sub.attended, sub.held);
        const bands = tallyBands(
          sub.students.map((x) => pct(x.a, x.h)),
          sub.students.map((x) => x.h),
        );
        const worst = sub.students
          .filter((x) => x.h > 0)
          .sort((x, y) => x.a / x.h - y.a / y.h || y.h - x.h)
          .slice(0, 5)
          .map((x) => ({
            student_id: x.student_id,
            roll_no: rosterById.get(x.student_id)?.roll_no ?? '',
            display_name: rosterById.get(x.student_id)?.display_name ?? '',
            attended: x.a,
            held: x.h,
            pct: pct(x.a, x.h),
          }));
        const inv = inventory.get(sub.subject_id);
        return {
          subject_id: sub.subject_id,
          subject_code: sub.subject_code,
          subject_name: sub.subject_name,
          attended: sub.attended,
          held: sub.held,
          pct: p,
          band: bandFor(p),
          bands,
          teachers: teachers.get(sub.subject_id) ?? [],
          sessions_marked: inv?.marked ?? 0,
          sessions_overdue_unmarked: inv?.overdue_unmarked ?? 0,
          sessions_upcoming: inv?.upcoming ?? 0,
          sessions_cancelled: inv?.cancelled ?? 0,
          worst_students: worst,
        };
      })
      .sort((a, b) => a.subject_code.localeCompare(b.subject_code));

    return { basis: s.basis, rows };
  }

  // --- teachers ------------------------------------------------------------

  /**
   * Per-teacher marking compliance. "Which faculty hasn't marked attendance" is
   * the thing an incharge chases weekly, and it is answered from the session
   * inventory, never from `marks` — an unmarked session has no attendance rows.
   */
  async teachers(s: AnalyticsScope): Promise<TeacherRow[]> {
    const rows = await this.dataSource.query<RawTeacherRow[]>(
      `${ROSTER_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT ss.effective_employee_id AS employee_id,
              emp.emp_code, emp.emp_display_name,
              COUNT(*)::int AS sessions,
              COUNT(*) FILTER (WHERE ss.status = 'completed')::int AS marked,
              COUNT(*) FILTER (WHERE ss.status = 'scheduled' AND ss.session_date < $5::date)::int AS overdue_unmarked,
              COUNT(*) FILTER (WHERE ss.status = 'scheduled' AND ss.session_date >= $5::date)::int AS upcoming,
              COUNT(*) FILTER (WHERE ss.status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE ss.effective_employee_id IS DISTINCT FROM ss.scheduled_employee_id)::int AS substituted_in
         FROM scoped_sessions ss
         LEFT JOIN employees emp ON emp.id = ss.effective_employee_id
        GROUP BY ss.effective_employee_id, emp.emp_code, emp.emp_display_name
        ORDER BY overdue_unmarked DESC, emp.emp_display_name ASC`,
      [...this.baseParams(s), s.today],
    );
    return rows.map((r) => ({
      ...r,
      compliance_pct: pct(r.marked, r.marked + r.overdue_unmarked),
    }));
  }

  // --- daily ---------------------------------------------------------------

  /**
   * Per-date group summary. `unmarked_sessions` is returned SEPARATELY rather
   * than folded into a denominator: the roster of a session is derived live and
   * varies (a cross-group elective's cohort isn't the group), so
   * `sessions × group_size` would be wrong for every elective. A deflated
   * percentage with no explanation is worse than an honest "3 of 7 sessions not
   * yet marked".
   */
  async daily(s: AnalyticsScope, matrix: boolean): Promise<DailyResult> {
    const days = await this.dataSource.query<RawDailyRow[]>(
      `${ROSTER_CTE},
       ${MARKS_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT d.session_date::text AS session_date,
              d.day_of_week,
              COALESCE(mk.attended, 0)::int AS attended,
              COALESCE(mk.held, 0)::int AS held,
              COALESCE(mk.sessions_marked, 0)::int AS sessions_marked,
              COALESCE(iv.overdue_unmarked, 0)::int AS overdue_unmarked,
              COALESCE(iv.upcoming, 0)::int AS upcoming,
              COALESCE(iv.cancelled, 0)::int AS cancelled
         FROM (
           SELECT DISTINCT session_date, day_of_week FROM scoped_sessions
         ) d
         LEFT JOIN (
           SELECT session_date,
                  COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS attended,
                  COUNT(*)::int AS held,
                  COUNT(DISTINCT session_id)::int AS sessions_marked
             FROM marks GROUP BY session_date
         ) mk ON mk.session_date = d.session_date
         LEFT JOIN (
           SELECT session_date,
                  COUNT(*) FILTER (WHERE status = 'scheduled' AND session_date < $5::date)::int AS overdue_unmarked,
                  COUNT(*) FILTER (WHERE status = 'scheduled' AND session_date >= $5::date)::int AS upcoming,
                  COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
             FROM scoped_sessions GROUP BY session_date
         ) iv ON iv.session_date = d.session_date
        ORDER BY d.session_date ASC`,
      [...this.baseParams(s), s.today],
    );

    const result: DailyResult = {
      basis: s.basis,
      days: days.map((d) => ({
        ...d,
        pct: pct(d.attended, d.held),
        band: bandFor(pct(d.attended, d.held)),
      })),
      matrix: null,
    };
    if (!matrix) return result;

    // Opt-in and range-capped: this is the one payload that grows as
    // students × days.
    // A size limit, not a permission decision — 400, not 403.
    if (days.length > MATRIX_MAX_DAYS) {
      throw new BadRequestException(
        `The day grid covers at most ${MATRIX_MAX_DAYS} teaching days — narrow the date range.`,
      );
    }
    const cells = await this.dataSource.query<RawMatrixCell[]>(
      `${ROSTER_CTE},
       ${MARKS_CTE}
       SELECT student_id, session_date::text AS session_date,
              COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS attended,
              COUNT(*)::int AS held
         FROM marks
        GROUP BY student_id, session_date`,
      this.baseParams(s),
    );
    result.matrix = {
      dates: days.map((d) => d.session_date),
      cells: cells.map((c) => ({ ...c, pct: pct(c.attended, c.held) })),
    };
    return result;
  }

  /** One day's sessions with every marked student's status — the deepest drill. */
  async dayDetail(s: AnalyticsScope, date: string): Promise<DayDetailResult> {
    // Bind the date to the validated window, else a caller can walk any date in
    // the semester regardless of the range they asked for.
    if (s.from && s.to && (date < s.from || date > s.to)) {
      throw new ForbiddenException('That date is outside the selected range.');
    }
    const sessions = await this.dataSource.query<RawDaySessionRow[]>(
      `${ROSTER_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT ss.id AS session_id, tp.position AS period_position,
              tp.label AS period_label, tp.start_time::text AS start_time,
              tp.end_time::text AS end_time, ss.span,
              sub.id AS subject_id, sub.code AS subject_code, sub.name AS subject_name,
              (ss.programme_semester_subject_option_id IS NOT NULL) AS is_elective,
              (ss.attendance_group_id IS NULL) AS is_cross_group,
              emp.emp_display_name AS teacher_display_name,
              (ss.effective_employee_id IS DISTINCT FROM ss.scheduled_employee_id) AS is_substitute,
              ss.status, ss.room
         FROM scoped_sessions ss
         JOIN timetable_periods tp ON tp.id = ss.timetable_period_id
         JOIN subjects sub ON sub.id = ss.subject_id
         LEFT JOIN employees emp ON emp.id = ss.effective_employee_id
        WHERE ss.session_date = $5::date
        ORDER BY tp.position ASC`,
      [...this.baseParams(s), date],
    );
    if (sessions.length === 0) {
      return { date, sessions: [] };
    }
    const marks = await this.dataSource.query<RawDayMarkRow[]>(
      `SELECT csa.class_session_id AS session_id, csa.student_id,
              s.student_id AS roll_no, s.display_name, csa.status
         FROM class_session_attendance csa
         JOIN students s ON s.id = csa.student_id
         JOIN student_groups sg ON sg.student_id = csa.student_id
        WHERE csa.class_session_id = ANY($1::int[])
          AND sg.attendance_group_id = ANY($2::int[])
        ORDER BY s.display_name ASC`,
      [sessions.map((x) => x.session_id), s.groupIds],
    );
    const bySession = new Map<number, RawDayMarkRow[]>();
    for (const m of marks) {
      const list = bySession.get(m.session_id) ?? [];
      list.push(m);
      bySession.set(m.session_id, list);
    }
    return {
      date,
      sessions: sessions.map((x) => {
        const students = bySession.get(x.session_id) ?? [];
        const attended = students.filter(
          (m) => m.status === 'present' || m.status === 'late',
        ).length;
        return {
          ...x,
          attended,
          marked: students.length,
          pct: pct(attended, students.length),
          students,
        };
      }),
    };
  }

  // --- sessions ------------------------------------------------------------

  /**
   * The session log — every session in the window whatever its state, so an
   * incharge can see what was never marked. Built on `scoped_sessions`, never
   * on `marks`.
   */
  async sessions(
    s: AnalyticsScope,
    filters: { subject_id?: number; state?: string },
  ): Promise<SessionsResult> {
    const rows = await this.dataSource.query<RawSessionLogRow[]>(
      `${ROSTER_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT ss.id AS session_id, ss.session_date::text AS session_date,
              ss.day_of_week, tp.position AS period_position, tp.label AS period_label,
              tp.start_time::text AS start_time, ss.span,
              sub.id AS subject_id, sub.code AS subject_code, sub.name AS subject_name,
              sched.emp_display_name AS scheduled_teacher,
              eff.emp_display_name AS effective_teacher,
              (ss.effective_employee_id IS DISTINCT FROM ss.scheduled_employee_id) AS is_substitute,
              (ss.timetable_entry_id IS NULL) AS is_adhoc,
              (ss.programme_semester_subject_option_id IS NOT NULL) AS is_elective,
              (ss.attendance_group_id IS NULL) AS is_cross_group,
              ss.status, ss.room, ss.cancel_reason,
              ss.attendance_marked_at,
              COALESCE(mk.marked, 0)::int AS marked,
              COALESCE(mk.attended, 0)::int AS attended
         FROM scoped_sessions ss
         JOIN timetable_periods tp ON tp.id = ss.timetable_period_id
         JOIN subjects sub ON sub.id = ss.subject_id
         LEFT JOIN employees sched ON sched.id = ss.scheduled_employee_id
         LEFT JOIN employees eff ON eff.id = ss.effective_employee_id
         LEFT JOIN (
           SELECT csa.class_session_id,
                  COUNT(*)::int AS marked,
                  COUNT(*) FILTER (WHERE csa.status IN ('present','late'))::int AS attended
             FROM class_session_attendance csa
             JOIN roster r ON r.student_id = csa.student_id
            GROUP BY csa.class_session_id
         ) mk ON mk.class_session_id = ss.id
        WHERE ($6::int IS NULL OR ss.subject_id = $6::int)
          AND ($7::text IS NULL OR $7 = 'all'
               OR ($7 = 'marked' AND ss.status = 'completed')
               OR ($7 = 'cancelled' AND ss.status = 'cancelled')
               OR ($7 = 'overdue_unmarked' AND ss.status = 'scheduled' AND ss.session_date < $5::date)
               OR ($7 = 'upcoming' AND ss.status = 'scheduled' AND ss.session_date >= $5::date))
        ORDER BY ss.session_date DESC, tp.position ASC`,
      [
        ...this.baseParams(s),
        s.today,
        filters.subject_id ?? null,
        filters.state ?? null,
      ],
    );
    return {
      rows: rows.map((r) => ({
        ...r,
        pct: pct(r.attended, r.marked),
        state:
          r.status === 'completed'
            ? 'marked'
            : r.status === 'cancelled'
              ? 'cancelled'
              : r.session_date < s.today
                ? 'overdue_unmarked'
                : 'upcoming',
      })),
    };
  }

  // --- overview ------------------------------------------------------------

  /** KPI header, trend, distributions and the data-quality warnings. */
  async overview(s: AnalyticsScope): Promise<OverviewResult> {
    const [students, compliance, byWeekday, byPeriod, warnings, daily] =
      await Promise.all([
        this.students(s),
        this.compliance(s),
        this.byWeekday(s),
        this.byPeriod(s),
        this.warnings(s),
        this.daily(s, false),
      ]);

    const attended = students.rows.reduce((a, b) => a + b.attended, 0);
    const held = students.rows.reduce((a, b) => a + b.held, 0);

    return {
      basis: s.basis,
      thresholds: {
        threshold: DEFAULT_THRESHOLD,
        condonation: CONDONATION_THRESHOLD,
        bands: [...ATTENDANCE_BANDS],
      },
      kpi: {
        students: students.rows.length,
        attended,
        held,
        pct: pct(attended, held),
        below_threshold: students.rows.filter((r) => r.below_threshold).length,
        below_condonation: students.rows.filter((r) => r.below_condonation)
          .length,
        sessions_remaining: students.sessions_remaining,
      },
      bands: tallyBands(
        students.rows.map((r) => r.pct),
        students.rows.map((r) => r.held),
      ),
      compliance,
      trend: daily.days,
      by_weekday: byWeekday,
      by_period: byPeriod,
      warnings,
      top_defaulters: students.rows
        .filter((r) => r.held > 0)
        .sort((a, b) => a.attended / a.held - b.attended / b.held)
        .slice(0, 5),
    };
  }

  // --- internals -----------------------------------------------------------

  /** `[groupIds, psIds, from, to]` — the four every CTE below is written against. */
  baseParams(
    s: AnalyticsScope,
  ): [number[], number[], string | null, string | null] {
    return [s.groupIds, s.psIds, s.from, s.to];
  }

  /**
   * Rollup basis: read `student_subject_attendance` + adjustments exactly as
   * `StudentAttendanceQueryService.dashboard` does, so the figures are the same
   * ones the student sees.
   *
   * The `JOIN ... ssa` (rather than a FULL OUTER over subjects) deliberately
   * drops a subject-scoped adjustment for a subject with no rollup row — the
   * student dashboard has the same behaviour, and diverging from it here would
   * defeat the purpose of this basis.
   */
  private async perSubjectFromRollup(
    s: AnalyticsScope,
  ): Promise<PerSubjectRow[]> {
    return this.dataSource.query<PerSubjectRow[]>(
      `${ROSTER_CTE}
       SELECT r.student_id, sub.id AS subject_id, sub.code AS subject_code,
              sub.name AS subject_name,
              (COALESCE(ssa.attended_count, 0) + COALESCE(adj.attended_sum, 0))::int AS attended,
              (COALESCE(ssa.held_count, 0) + COALESCE(adj.held_sum, 0))::int AS held
         FROM roster r
         JOIN student_subject_attendance ssa
           ON ssa.student_id = r.student_id
          AND ssa.programme_semester_id = ANY($2::int[])
         JOIN subjects sub ON sub.id = ssa.subject_id
         LEFT JOIN LATERAL (
           SELECT SUM(a.attended_delta)::int AS attended_sum,
                  SUM(a.held_delta)::int AS held_sum
             FROM attendance_adjustments a
            WHERE a.student_id = ssa.student_id
              AND a.programme_semester_id = ssa.programme_semester_id
              AND a.subject_id = ssa.subject_id
         ) adj ON TRUE
        ORDER BY r.student_id, sub.code ASC`,
      [s.groupIds, s.psIds],
    );
  }

  /** Sessions basis: live scan of the marked sessions in the window. */
  private async perSubjectFromSessions(
    s: AnalyticsScope,
  ): Promise<PerSubjectRow[]> {
    return this.dataSource.query<PerSubjectRow[]>(
      `${ROSTER_CTE},
       ${MARKS_CTE}
       SELECT m.student_id, sub.id AS subject_id, sub.code AS subject_code,
              sub.name AS subject_name,
              COUNT(*) FILTER (WHERE m.status IN ('present','late'))::int AS attended,
              COUNT(*)::int AS held
         FROM marks m
         JOIN subjects sub ON sub.id = m.subject_id
        GROUP BY m.student_id, sub.id, sub.code, sub.name
        ORDER BY m.student_id, sub.code ASC`,
      this.baseParams(s),
    );
  }

  /** Adjustments with `subject_id IS NULL` move the overall figure only. One
   *  batched query rather than the dashboard's per-student round-trip. */
  private async overallAdjustments(
    s: AnalyticsScope,
  ): Promise<Map<number, { attended: number; held: number }>> {
    const rows = await this.dataSource.query<
      Array<{ student_id: number; attended_sum: number; held_sum: number }>
    >(
      `SELECT a.student_id,
              SUM(a.attended_delta)::int AS attended_sum,
              SUM(a.held_delta)::int AS held_sum
         FROM attendance_adjustments a
        WHERE a.programme_semester_id = ANY($1::int[])
          AND a.subject_id IS NULL
          AND a.student_id = ANY($2::int[])
        GROUP BY a.student_id`,
      [s.psIds, s.rosterIds],
    );
    return new Map(
      rows.map((r) => [
        Number(r.student_id),
        { attended: Number(r.attended_sum), held: Number(r.held_sum) },
      ]),
    );
  }

  /**
   * Current absent streak and an estimate of when the student joined this
   * group. The streak counts trailing days on which they were marked but never
   * present — three in a row is the trigger for a parent call, long before the
   * 75% line is crossed.
   */
  private async studentExtras(
    s: AnalyticsScope,
  ): Promise<
    Map<
      number,
      { current_absent_streak: number; joined_group_estimate: string | null }
    >
  > {
    const rows = await this.dataSource.query<
      Array<{
        student_id: number;
        current_absent_streak: number;
        joined_group_estimate: string | null;
      }>
    >(
      `${ROSTER_CTE},
       ${MARKS_CTE},
       day_state AS (
         SELECT student_id, session_date,
                BOOL_OR(status IN ('present','late')) AS any_present
           FROM marks GROUP BY student_id, session_date
       ),
       ranked AS (
         SELECT student_id, session_date, any_present,
                ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY session_date DESC) AS rn
           FROM day_state
       ),
       last_present AS (
         SELECT student_id, MIN(rn) AS rn FROM ranked WHERE any_present GROUP BY student_id
       ),
       totals AS (
         SELECT student_id, COUNT(*) AS days FROM ranked GROUP BY student_id
       )
       SELECT t.student_id,
              COALESCE(lp.rn - 1, t.days)::int AS current_absent_streak,
              (SELECT MIN(m2.session_date)::text FROM marks m2
                JOIN class_sessions cs2 ON cs2.id = m2.session_id
               WHERE m2.student_id = t.student_id
                 AND cs2.attendance_group_id = ANY($1::int[])) AS joined_group_estimate
         FROM totals t
         LEFT JOIN last_present lp ON lp.student_id = t.student_id`,
      this.baseParams(s),
    );
    return new Map(
      rows.map((r) => [
        Number(r.student_id),
        {
          current_absent_streak: Number(r.current_absent_streak),
          joined_group_estimate: r.joined_group_estimate,
        },
      ]),
    );
  }

  /** Scheduled sessions still ahead — the denominator for "can they still make
   *  75%?". Group-level: a cross-group elective's cohort isn't the group, so
   *  per-student remaining would differ; treated as an estimate. */
  private async remainingSessions(s: AnalyticsScope): Promise<number> {
    const rows = await this.dataSource.query<Array<{ n: string }>>(
      `${ROSTER_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT COUNT(*)::int AS n FROM scoped_sessions
        WHERE status = 'scheduled' AND session_date >= $5::date`,
      [...this.baseParams(s), s.today],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Marking compliance. `cancelled` and `upcoming` are excluded from BOTH sides
   * of the ratio — the only definition that neither punishes an incharge for a
   * holiday nor rewards them for a future week.
   *
   * `marked_but_empty` catches the reachable edge where a session was marked
   * with an empty roster: status flips to `completed` but no attendance rows
   * exist, giving a silent zero denominator.
   */
  async compliance(s: AnalyticsScope): Promise<ComplianceResult> {
    const rows = await this.dataSource.query<Array<RawCompliance>>(
      `${ROSTER_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS marked,
              COUNT(*) FILTER (WHERE status = 'scheduled' AND session_date < $5::date)::int AS overdue_unmarked,
              COUNT(*) FILTER (WHERE status = 'scheduled' AND session_date >= $5::date)::int AS upcoming,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (
                WHERE status = 'completed'
                  AND NOT EXISTS (SELECT 1 FROM class_session_attendance x
                                   WHERE x.class_session_id = scoped_sessions.id)
              )::int AS marked_but_empty
         FROM scoped_sessions`,
      [...this.baseParams(s), s.today],
    );
    const r = rows[0] ?? {
      marked: 0,
      overdue_unmarked: 0,
      upcoming: 0,
      cancelled: 0,
      marked_but_empty: 0,
    };
    return {
      ...r,
      pct: pct(r.marked, r.marked + r.overdue_unmarked),
      // A completed semester refuses further marking, so its overdue backlog is
      // permanent rather than an action item.
      is_locked: s.locked,
    };
  }

  async byWeekday(s: AnalyticsScope): Promise<BucketRow[]> {
    const rows = await this.dataSource.query<RawBucket[]>(
      `${ROSTER_CTE},
       ${MARKS_CTE}
       SELECT day_of_week AS bucket,
              COUNT(*) FILTER (WHERE status IN ('present','late'))::int AS attended,
              COUNT(*)::int AS held,
              COUNT(DISTINCT session_id)::int AS sessions
         FROM marks GROUP BY day_of_week ORDER BY day_of_week ASC`,
      this.baseParams(s),
    );
    return rows.map((r) => ({ ...r, pct: pct(r.attended, r.held) }));
  }

  /**
   * Attendance by period position. Span-expanded: a lab at positions 3–5 is one
   * row marked once, so without the expansion positions 4 and 5 look idle.
   *
   * The per-position percentage is valid (numerator and denominator expand
   * together) but the COLUMN TOTAL is not — summing `held` across positions
   * exceeds the real total. `span_expanded` tells the client never to sum this
   * axis.
   *
   * Grouped on `tp.position`, never `timetable_period_id`: period rows belong to
   * a timetable, so ids are disjoint across templates and across groups.
   */
  async byPeriod(s: AnalyticsScope): Promise<BucketRow[]> {
    const rows = await this.dataSource.query<RawBucket[]>(
      `${ROSTER_CTE},
       ${MARKS_CTE}
       SELECT pos AS bucket,
              COUNT(*) FILTER (WHERE m.status IN ('present','late'))::int AS attended,
              COUNT(*)::int AS held,
              COUNT(DISTINCT m.session_id)::int AS sessions
         FROM marks m
         JOIN timetable_periods tp ON tp.id = m.timetable_period_id
         CROSS JOIN LATERAL generate_series(tp.position, tp.position + GREATEST(m.span, 1) - 1) AS pos
        GROUP BY pos ORDER BY pos ASC`,
      this.baseParams(s),
    );
    return rows.map((r) => ({ ...r, pct: pct(r.attended, r.held) }));
  }

  /**
   * Data-quality flags the UI must surface rather than silently average over.
   *
   * `duplicate_elective_sessions` — `UQ_class_sessions_key` includes
   * `timetable_period_id`, which is per-timetable, so when two groups publish a
   * week containing the same cross-group elective slot the ON CONFLICT does not
   * fire and BOTH rows are inserted for one physical class. If a teacher marks
   * both, the rollup counts two held. The durable fix belongs in the seeder.
   *
   * `timetable_templates` — more than one template contributing to the window
   * makes period-position comparison approximate, because break rows occupy
   * positions and templates can place them differently.
   */
  async warnings(s: AnalyticsScope): Promise<WarningsResult> {
    const [dupes, templates] = await Promise.all([
      this.dataSource.query<Array<{ n: string }>>(
        `${ROSTER_CTE},
         ${SCOPED_SESSIONS_CTE}
         SELECT COUNT(*)::int AS n FROM (
           SELECT 1 FROM scoped_sessions
            WHERE attendance_group_id IS NULL
              AND programme_semester_subject_option_id IS NOT NULL
            GROUP BY session_date, programme_semester_subject_option_id, scheduled_employee_id
           HAVING COUNT(*) > 1
         ) d`,
        this.baseParams(s),
      ),
      this.dataSource.query<Array<{ n: string }>>(
        `${ROSTER_CTE},
         ${SCOPED_SESSIONS_CTE}
         SELECT COUNT(DISTINCT tp.timetable_id)::int AS n
           FROM scoped_sessions ss
           JOIN timetable_periods tp ON tp.id = ss.timetable_period_id`,
        this.baseParams(s),
      ),
    ]);
    return {
      duplicate_elective_sessions: Number(dupes[0]?.n ?? 0),
      timetable_templates: Number(templates[0]?.n ?? 0),
    };
  }

  private async sessionInventoryBySubject(
    s: AnalyticsScope,
  ): Promise<Map<number, RawCompliance>> {
    const rows = await this.dataSource.query<
      Array<RawCompliance & { subject_id: number }>
    >(
      `${ROSTER_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT subject_id,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS marked,
              COUNT(*) FILTER (WHERE status = 'scheduled' AND session_date < $5::date)::int AS overdue_unmarked,
              COUNT(*) FILTER (WHERE status = 'scheduled' AND session_date >= $5::date)::int AS upcoming,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              0::int AS marked_but_empty
         FROM scoped_sessions GROUP BY subject_id`,
      [...this.baseParams(s), s.today],
    );
    return new Map(rows.map((r) => [Number(r.subject_id), r]));
  }

  private async teachersBySubject(
    s: AnalyticsScope,
  ): Promise<Map<number, string[]>> {
    const rows = await this.dataSource.query<
      Array<{ subject_id: number; name: string }>
    >(
      `${ROSTER_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT DISTINCT ss.subject_id, emp.emp_display_name AS name
         FROM scoped_sessions ss
         JOIN employees emp ON emp.id = ss.effective_employee_id
        ORDER BY name ASC`,
      this.baseParams(s),
    );
    const out = new Map<number, string[]>();
    for (const r of rows) {
      const list = out.get(Number(r.subject_id)) ?? [];
      list.push(r.name);
      out.set(Number(r.subject_id), list);
    }
    return out;
  }
}

// --- result shapes ---------------------------------------------------------

export interface PerSubjectRow {
  student_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  attended: number;
  held: number;
}

export interface StudentRow extends RosterRow {
  attended: number;
  held: number;
  pct: number;
  band: string;
  below_threshold: boolean;
  below_condonation: boolean;
  /** Null when even attending every remaining session can't reach the
   *  threshold — the signal a condonation case is already unavoidable. */
  sessions_needed: number | null;
  max_achievable_pct: number;
  current_absent_streak: number;
  joined_group_estimate: string | null;
  per_subject: Array<
    PerSubjectRow & {
      pct: number;
      band: string;
      below_threshold: boolean;
      below_condonation: boolean;
    }
  >;
}

export interface StudentsResult {
  basis: AnalyticsBasis;
  sessions_remaining: number;
  rows: StudentRow[];
}

export interface StudentSessionRow {
  session_id: number;
  session_date: string;
  day_of_week: number;
  period_position: number;
  period_label: string;
  start_time: string;
  end_time: string;
  span: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  is_elective: boolean;
  teacher_display_name: string | null;
  is_substitute: boolean;
  status: string;
}

export interface StudentDetailResult {
  basis: AnalyticsBasis;
  student: StudentRow;
  sessions: StudentSessionRow[];
}

export interface BandTally {
  key: string;
  label: string;
  count: number;
}

interface SubjectAgg {
  subject_id: number;
  subject_code: string;
  subject_name: string;
  attended: number;
  held: number;
  students: Array<{ student_id: number; a: number; h: number }>;
}

export interface SubjectRow {
  subject_id: number;
  subject_code: string;
  subject_name: string;
  attended: number;
  held: number;
  pct: number;
  band: string;
  bands: BandTally[];
  teachers: string[];
  sessions_marked: number;
  sessions_overdue_unmarked: number;
  sessions_upcoming: number;
  sessions_cancelled: number;
  worst_students: Array<{
    student_id: number;
    roll_no: string;
    display_name: string;
    attended: number;
    held: number;
    pct: number;
  }>;
}

export interface SubjectsResult {
  basis: AnalyticsBasis;
  rows: SubjectRow[];
}

interface RawTeacherRow {
  employee_id: number;
  emp_code: string | null;
  emp_display_name: string | null;
  sessions: number;
  marked: number;
  overdue_unmarked: number;
  upcoming: number;
  cancelled: number;
  substituted_in: number;
}

export interface TeacherRow extends RawTeacherRow {
  compliance_pct: number;
}

interface RawDailyRow {
  session_date: string;
  day_of_week: number;
  attended: number;
  held: number;
  sessions_marked: number;
  overdue_unmarked: number;
  upcoming: number;
  cancelled: number;
}

export interface DailyRow extends RawDailyRow {
  pct: number;
  band: string;
}

interface RawMatrixCell {
  student_id: number;
  session_date: string;
  attended: number;
  held: number;
}

export interface DailyResult {
  basis: AnalyticsBasis;
  days: DailyRow[];
  /** Opt-in via `?matrix=true`. A cell absent for a (student, date) pair means
   *  the student had no marked session that day — render it as "no session",
   *  never as absent. */
  matrix: {
    dates: string[];
    cells: Array<RawMatrixCell & { pct: number }>;
  } | null;
}

interface RawDaySessionRow {
  session_id: number;
  period_position: number;
  period_label: string;
  start_time: string;
  end_time: string;
  span: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  is_elective: boolean;
  is_cross_group: boolean;
  teacher_display_name: string | null;
  is_substitute: boolean;
  status: string;
  room: string | null;
}

interface RawDayMarkRow {
  session_id: number;
  student_id: number;
  roll_no: string;
  display_name: string;
  status: string;
}

export interface DayDetailResult {
  date: string;
  sessions: Array<
    RawDaySessionRow & {
      attended: number;
      marked: number;
      pct: number;
      students: RawDayMarkRow[];
    }
  >;
}

interface RawSessionLogRow {
  session_id: number;
  session_date: string;
  day_of_week: number;
  period_position: number;
  period_label: string;
  start_time: string;
  span: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  scheduled_teacher: string | null;
  effective_teacher: string | null;
  is_substitute: boolean;
  is_adhoc: boolean;
  is_elective: boolean;
  is_cross_group: boolean;
  status: string;
  room: string | null;
  cancel_reason: string | null;
  attendance_marked_at: Date | null;
  marked: number;
  attended: number;
}

export interface SessionsResult {
  rows: Array<RawSessionLogRow & { pct: number; state: string }>;
}

interface RawCompliance {
  marked: number;
  overdue_unmarked: number;
  upcoming: number;
  cancelled: number;
  marked_but_empty: number;
}

export interface ComplianceResult extends RawCompliance {
  pct: number;
  is_locked: boolean;
}

interface RawBucket {
  bucket: number;
  attended: number;
  held: number;
  sessions: number;
}

export interface BucketRow extends RawBucket {
  pct: number;
}

export interface WarningsResult {
  duplicate_elective_sessions: number;
  timetable_templates: number;
}

export interface OverviewResult {
  basis: AnalyticsBasis;
  thresholds: {
    threshold: number;
    condonation: number;
    bands: Array<{ key: string; label: string; min: number; max: number }>;
  };
  kpi: {
    students: number;
    attended: number;
    held: number;
    pct: number;
    below_threshold: number;
    below_condonation: number;
    sessions_remaining: number;
  };
  bands: BandTally[];
  compliance: ComplianceResult;
  trend: DailyRow[];
  by_weekday: BucketRow[];
  /** Span-expanded — per-position percentages are valid, the column total is
   *  not. Never sum this axis. */
  by_period: BucketRow[];
  warnings: WarningsResult;
  top_defaulters: StudentRow[];
}

export interface SemesterSummary {
  id: number;
  programme_id: number;
  admission_year_id: number;
  semester_id: number;
  status: string;
  planned_start_date: string | null;
  planned_end_date: string | null;
  semester: { id: number; sem_number: number; code: string };
}

/** Today's date in campus time as `YYYY-MM-DD`. */
export function campusToday(): string {
  // en-CA renders ISO-shaped dates, so this is a locale trick rather than
  // manual offset arithmetic that would break on a DST-less assumption.
  return new Date().toLocaleDateString('en-CA', { timeZone: DISPLAY_TZ });
}

/** Band key for a rounded percentage — the same buckets every client renders. */
export function bandFor(percentage: number): string {
  const hit = ATTENDANCE_BANDS.find(
    (b) => percentage >= b.min && percentage < b.max,
  );
  return hit?.key ?? 'good';
}

/**
 * Distribution of percentages across the bands, always returning every band so
 * a chart keeps a stable x-axis when a bucket empties. Entries whose `held` is
 * 0 are skipped — a student with no sessions yet is not "below 50%", they are
 * simply unmeasured, and counting them as critical would put a phantom spike on
 * every chart in the first week of a semester.
 */
export function tallyBands(
  percentages: number[],
  helds: number[],
): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  percentages.forEach((p, i) => {
    if ((helds[i] ?? 0) <= 0) return;
    const key = bandFor(p);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return ATTENDANCE_BANDS.map((b) => ({
    key: b.key,
    label: b.label,
    count: counts.get(b.key) ?? 0,
  }));
}

/**
 * Threshold tests computed from the RAW ratio, never the rounded percentage.
 * `pct()` rounds, so a student at 74.96% renders as `75.0` — a client doing
 * `pct >= 75` would drop a real defaulter off a detention list.
 */
export function thresholds(
  attended: number,
  held: number,
): { below_threshold: boolean; below_condonation: boolean } {
  if (held <= 0) {
    return { below_threshold: false, below_condonation: false };
  }
  const ratio = (attended / held) * 100;
  return {
    below_threshold: ratio < DEFAULT_THRESHOLD,
    below_condonation: ratio < CONDONATION_THRESHOLD,
  };
}

/**
 * How many more consecutive sessions the student must attend to reach the
 * threshold, and the best percentage still reachable if they attend everything
 * left. Both are what a condonation committee actually asks for.
 */
export function projection(
  attended: number,
  held: number,
  remaining: number,
): { sessions_needed: number | null; max_achievable_pct: number } {
  const t = DEFAULT_THRESHOLD / 100;
  const maxAchievable = pct(attended + remaining, held + remaining);
  if (held > 0 && attended / held >= t) {
    return { sessions_needed: 0, max_achievable_pct: maxAchievable };
  }
  // attend `n` more of the remaining: (attended + n) / (held + n) >= t
  const n = Math.ceil((t * held - attended) / (1 - t));
  return {
    sessions_needed: n > remaining ? null : Math.max(n, 0),
    max_achievable_pct: maxAchievable,
  };
}
