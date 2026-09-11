import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { pct } from '../../../admin/sessions/student-attendance-query.service';
import {
  ATTENDANCE_BANDS,
  AnalyticsScope,
  AttendanceAnalyticsService,
  CONDONATION_THRESHOLD,
  DEFAULT_THRESHOLD,
  bandFor,
  tallyBands,
  type BandTally,
  type OverviewResult,
  type StudentDetailResult,
  type StudentRow,
  type SubjectsResult,
} from '../../attendance-analytics/attendance-analytics.service';
import {
  MARKS_CTE,
  ROSTER_CTE,
  SCOPED_SESSIONS_CTE,
} from '../../attendance-analytics/attendance-analytics.sql';
import {
  InsightsScope,
  ScopeBatch,
  ScopeGroup,
} from '../insights-scope.service';
import { num, round2 } from '../insights.sql';

/** A department-wide live scan is bounded; the rollup basis has no window. */
const MAX_SESSIONS_WINDOW_DAYS = 120;

export interface AttendanceScope extends AnalyticsScope {
  groups: ScopeGroup[];
  batches: ScopeBatch[];
  /** Chosen programme semester per batch (pay_id → ps). */
  psByPay: Map<number, ChosenSemester>;
  semester: number | null;
  /** Earliest planned start among the chosen semesters — the leave window floor. */
  windowStart: string;
}

export interface ChosenSemester {
  id: number;
  pay_id: number;
  status: string;
  sem_number: number;
  planned_start_date: string | null;
  planned_end_date: string | null;
}

export interface RollupRow {
  key: string;
  parent_key: string | null;
  level: 'department' | 'programme' | 'batch' | 'section';
  id: number;
  label: string;
  sublabel: string | null;
  students: number;
  attended: number;
  held: number;
  pct: number;
  band: string;
  bands: BandTally[];
  below_threshold: number;
  below_condonation: number;
  marked: number;
  overdue_unmarked: number;
  upcoming: number;
  cancelled: number;
  compliance_pct: number;
  /** Section rows carry the semester they were answered from. */
  sem_number: number | null;
}

export interface RollupResult {
  basis: AnalyticsScope['basis'];
  locked: boolean;
  thresholds: { threshold: number; condonation: number; bands: BandTally[] };
  rows: RollupRow[];
  totals: Pick<
    RollupRow,
    | 'students'
    | 'attended'
    | 'held'
    | 'pct'
    | 'band'
    | 'bands'
    | 'below_threshold'
    | 'below_condonation'
    | 'marked'
    | 'overdue_unmarked'
    | 'upcoming'
    | 'cancelled'
    | 'compliance_pct'
  >;
}

export interface InsightsStudentRow extends StudentRow {
  group_id: number | null;
  group_name: string | null;
  pay_id: number | null;
  batch_label: string | null;
  department_code: string | null;
}

export interface FacultyRow {
  employee_id: number | null;
  emp_code: string | null;
  emp_display_name: string | null;
  department_id: number | null;
  department_code: string | null;
  sessions: number;
  marked: number;
  overdue_unmarked: number;
  upcoming: number;
  cancelled: number;
  substituted_in: number;
  compliance_pct: number;
  weeks: number;
  sessions_per_week: number;
  subjects: number;
  sections: number;
  attended: number;
  held: number;
  /** Class attendance in the sessions this teacher marked. */
  pct: number;
}

export interface LeavesResult {
  window: { from: string; to: string };
  by_group: Array<{
    group_id: number;
    leave_type_id: number;
    leave_type: string;
    approved: number;
    pending: number;
    rejected: number;
    approved_days: number;
  }>;
  pending: { count: number; oldest_days: number | null };
  top_students: Array<{
    student_id: number;
    roll_no: string;
    display_name: string;
    group_id: number;
    leaves: number;
    days: number;
  }>;
}

/**
 * Attendance over an RBAC scope — every group of every batch the caller may
 * read, each batch contributing one programme semester.
 *
 * Nearly everything is the incharge analytics service run over a wider
 * `AnalyticsScope`; the only new SQL is what a single group never needed —
 * a per-section compliance split, the faculty load view and leave volume.
 */
@Injectable()
export class InsightsAttendanceService {
  constructor(
    private readonly analytics: AttendanceAnalyticsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Pick one programme semester per batch — the requested semester number, or
   * each batch's ongoing one — and build the analytics scope over every
   * section of those batches. `null` when no batch has a usable semester.
   */
  async resolve(
    scope: InsightsScope,
    q: { semester?: number; from?: string; to?: string },
  ): Promise<AttendanceScope | null> {
    if (scope.payIds.length === 0) return null;
    if (q.from && q.to) {
      const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 + 1;
      if (days > MAX_SESSIONS_WINDOW_DAYS) {
        // A size limit, not a permission decision — 400, not 403.
        throw new BadRequestException(
          `A dated view covers at most ${MAX_SESSIONS_WINDOW_DAYS} days — narrow the range or clear it for the whole-semester rollup.`,
        );
      }
    }

    const rows = await this.dataSource.query<
      Array<ChosenSemester & { pay_id: number }>
    >(
      `SELECT ps.id, pay.id AS pay_id, ps.status, sem.sem_number,
              ps.planned_start_date::text AS planned_start_date,
              ps.planned_end_date::text AS planned_end_date
         FROM programme_semesters ps
         JOIN semesters sem ON sem.id = ps.semester_id
         JOIN programme_admission_years pay
           ON pay.programme_id = ps.programme_id
          AND pay.admission_year_id = ps.admission_year_id
        WHERE pay.id = ANY($1::int[]) AND ps.is_active = TRUE
        ORDER BY pay.id, sem.sem_number DESC`,
      [scope.payIds],
    );

    const psByPay = new Map<number, ChosenSemester>();
    for (const r of rows) {
      const payId = num(r.pay_id);
      if (psByPay.has(payId)) continue;
      const hit =
        q.semester !== undefined
          ? num(r.sem_number) === q.semester
          : r.status === 'ongoing';
      if (hit) {
        psByPay.set(payId, {
          id: num(r.id),
          pay_id: payId,
          status: r.status,
          sem_number: num(r.sem_number),
          planned_start_date: r.planned_start_date,
          planned_end_date: r.planned_end_date,
        });
      }
    }
    const groups = scope.groups.filter((g) => psByPay.has(g.pay_id));
    if (groups.length === 0) return null;

    const chosen = [...psByPay.values()];
    const locked = chosen.every((ps) => ps.status !== 'ongoing');
    const base = await this.analytics.buildScope(
      groups.map((g) => g.id),
      chosen.map((ps) => ps.id),
      locked,
      q.from,
      q.to,
    );
    const starts = chosen
      .map((ps) => ps.planned_start_date)
      .filter((d): d is string => !!d)
      .sort();
    return {
      ...base,
      groups,
      batches: scope.batches.filter((b) => psByPay.has(b.pay_id)),
      psByPay,
      semester: q.semester ?? null,
      windowStart:
        starts[0] ?? shiftDays(base.today, -MAX_SESSIONS_WINDOW_DAYS),
    };
  }

  // --- rollup ----------------------------------------------------------------

  /**
   * The hierarchy: department → programme → batch → section. Percentages are
   * summed from the same per-student rows the Students tab shows, so a section
   * row here and its roster there can never disagree. Marking compliance is
   * split by the session's own `attendance_group_id`; cross-group elective
   * sessions carry none and are counted on the batch row only, which is why a
   * batch's compliance is not always the sum of its sections.
   */
  async rollup(s: AttendanceScope): Promise<RollupResult> {
    const [students, compliance, groupOf] = await Promise.all([
      this.analytics.students(s),
      this.complianceSplit(s),
      this.groupOfStudents(s),
    ]);

    type Acc = {
      rows: StudentRow[];
      marked: number;
      overdue: number;
      upcoming: number;
      cancelled: number;
    };
    const fresh = (): Acc => ({
      rows: [],
      marked: 0,
      overdue: 0,
      upcoming: 0,
      cancelled: 0,
    });
    const acc = new Map<string, Acc>();
    const touch = (key: string) => {
      let a = acc.get(key);
      if (!a) {
        a = fresh();
        acc.set(key, a);
      }
      return a;
    };

    const batchByPay = new Map(s.batches.map((b) => [b.pay_id, b]));
    const groupById = new Map(s.groups.map((g) => [g.id, g]));
    const keysOf = (g: ScopeGroup) => {
      const b = batchByPay.get(g.pay_id);
      if (!b) return [];
      return [
        `d:${b.department_id}`,
        `p:${b.programme_id}`,
        `b:${b.pay_id}`,
        `g:${g.id}`,
      ];
    };

    for (const row of students.rows) {
      const gid = groupOf.get(row.student_id);
      const g = gid === undefined ? undefined : groupById.get(gid);
      if (!g) continue;
      for (const k of keysOf(g)) touch(k).rows.push(row);
    }
    for (const c of compliance) {
      const g = c.attendance_group_id
        ? groupById.get(c.attendance_group_id)
        : undefined;
      const b =
        g?.pay_id !== undefined
          ? batchByPay.get(g.pay_id)
          : s.batches.find(
              (x) => s.psByPay.get(x.pay_id)?.id === c.programme_semester_id,
            );
      if (!b) continue;
      const keys = [
        `d:${b.department_id}`,
        `p:${b.programme_id}`,
        `b:${b.pay_id}`,
      ];
      if (g) keys.push(`g:${g.id}`);
      for (const k of keys) {
        const a = touch(k);
        a.marked += c.marked;
        a.overdue += c.overdue_unmarked;
        a.upcoming += c.upcoming;
        a.cancelled += c.cancelled;
      }
    }

    const measure = (a: Acc) => {
      const attended = a.rows.reduce((x, r) => x + r.attended, 0);
      const held = a.rows.reduce((x, r) => x + r.held, 0);
      const p = pct(attended, held);
      return {
        students: a.rows.length,
        attended,
        held,
        pct: p,
        band: bandFor(p),
        bands: tallyBands(
          a.rows.map((r) => r.pct),
          a.rows.map((r) => r.held),
        ),
        below_threshold: a.rows.filter((r) => r.below_threshold).length,
        below_condonation: a.rows.filter((r) => r.below_condonation).length,
        marked: a.marked,
        overdue_unmarked: a.overdue,
        upcoming: a.upcoming,
        cancelled: a.cancelled,
        compliance_pct: pct(a.marked, a.marked + a.overdue),
      };
    };

    const rows: RollupRow[] = [];
    const seen = new Set<string>();
    for (const b of s.batches) {
      const dk = `d:${b.department_id}`;
      if (!seen.has(dk)) {
        seen.add(dk);
        rows.push({
          key: dk,
          parent_key: null,
          level: 'department',
          id: b.department_id,
          label: b.department_code,
          sublabel: null,
          sem_number: null,
          ...measure(touch(dk)),
        });
      }
      const pk = `p:${b.programme_id}`;
      if (!seen.has(pk)) {
        seen.add(pk);
        rows.push({
          key: pk,
          parent_key: dk,
          level: 'programme',
          id: b.programme_id,
          label: b.programme_code,
          sublabel: b.programme_name,
          sem_number: null,
          ...measure(touch(pk)),
        });
      }
      const bk = `b:${b.pay_id}`;
      const ps = s.psByPay.get(b.pay_id);
      rows.push({
        key: bk,
        parent_key: pk,
        level: 'batch',
        id: b.pay_id,
        label: b.display_year,
        sublabel: ps ? `Semester ${ps.sem_number}` : null,
        sem_number: ps?.sem_number ?? null,
        ...measure(touch(bk)),
      });
      for (const g of s.groups.filter((x) => x.pay_id === b.pay_id)) {
        rows.push({
          key: `g:${g.id}`,
          parent_key: bk,
          level: 'section',
          id: g.id,
          label: g.name,
          sublabel: g.code,
          sem_number: ps?.sem_number ?? null,
          ...measure(touch(`g:${g.id}`)),
        });
      }
    }

    const all = fresh();
    all.rows = students.rows.filter((r) => groupOf.has(r.student_id));
    for (const c of compliance) {
      all.marked += c.marked;
      all.overdue += c.overdue_unmarked;
      all.upcoming += c.upcoming;
      all.cancelled += c.cancelled;
    }

    return {
      basis: s.basis,
      locked: s.locked,
      thresholds: {
        threshold: DEFAULT_THRESHOLD,
        condonation: CONDONATION_THRESHOLD,
        bands: ATTENDANCE_BANDS.map((b) => ({
          key: b.key,
          label: b.label,
          count: 0,
        })),
      },
      rows,
      totals: measure(all),
    };
  }

  // --- students / subjects / detail / overview --------------------------------

  async students(s: AttendanceScope): Promise<{
    basis: AnalyticsScope['basis'];
    sessions_remaining: number;
    rows: InsightsStudentRow[];
  }> {
    const [res, groupOf] = await Promise.all([
      this.analytics.students(s),
      this.groupOfStudents(s),
    ]);
    const groupById = new Map(s.groups.map((g) => [g.id, g]));
    const batchByPay = new Map(s.batches.map((b) => [b.pay_id, b]));
    return {
      basis: res.basis,
      sessions_remaining: res.sessions_remaining,
      rows: res.rows.map((r) => {
        const g = groupById.get(groupOf.get(r.student_id) ?? -1);
        const b = g ? batchByPay.get(g.pay_id) : undefined;
        return {
          ...r,
          group_id: g?.id ?? null,
          group_name: g?.name ?? null,
          pay_id: b?.pay_id ?? null,
          batch_label: b ? `${b.programme_code} · ${b.display_year}` : null,
          department_code: b?.department_code ?? null,
        };
      }),
    };
  }

  studentDetail(
    s: AttendanceScope,
    studentId: number,
  ): Promise<StudentDetailResult> {
    return this.analytics.studentDetail(s, studentId);
  }

  subjects(s: AttendanceScope): Promise<SubjectsResult> {
    return this.analytics.subjects(s);
  }

  overview(s: AttendanceScope): Promise<OverviewResult> {
    return this.analytics.overview(s);
  }

  // --- faculty ------------------------------------------------------------

  /**
   * Per-teacher load and marking compliance across the scope. Compliance is
   * answered from the session inventory (an unmarked session has no attendance
   * rows); the class-attendance column comes from `marks` and describes how the
   * students turned up for THIS teacher's marked sessions.
   */
  async faculty(s: AttendanceScope): Promise<FacultyRow[]> {
    const [inventory, presence] = await Promise.all([
      this.dataSource.query<
        Array<{
          employee_id: number | null;
          emp_code: string | null;
          emp_display_name: string | null;
          department_id: number | null;
          department_code: string | null;
          sessions: string;
          marked: string;
          overdue_unmarked: string;
          upcoming: string;
          cancelled: string;
          substituted_in: string;
          weeks: string;
          subjects: string;
          sections: string;
        }>
      >(
        `${ROSTER_CTE},
         ${SCOPED_SESSIONS_CTE}
         SELECT ss.effective_employee_id AS employee_id,
                emp.emp_code, emp.emp_display_name, emp.department_id,
                d.code AS department_code,
                COUNT(*) AS sessions,
                COUNT(*) FILTER (WHERE ss.status = 'completed') AS marked,
                COUNT(*) FILTER (WHERE ss.status = 'scheduled' AND ss.session_date < $5::date) AS overdue_unmarked,
                COUNT(*) FILTER (WHERE ss.status = 'scheduled' AND ss.session_date >= $5::date) AS upcoming,
                COUNT(*) FILTER (WHERE ss.status = 'cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE ss.effective_employee_id IS DISTINCT FROM ss.scheduled_employee_id) AS substituted_in,
                COUNT(DISTINCT date_trunc('week', ss.session_date)) FILTER (WHERE ss.status <> 'cancelled' AND ss.session_date <= $5::date) AS weeks,
                COUNT(DISTINCT ss.subject_id) AS subjects,
                COUNT(DISTINCT COALESCE(ss.attendance_group_id, -ss.programme_semester_id)) AS sections
           FROM scoped_sessions ss
           LEFT JOIN employees emp ON emp.id = ss.effective_employee_id
           LEFT JOIN departments d ON d.id = emp.department_id
          GROUP BY ss.effective_employee_id, emp.emp_code, emp.emp_display_name,
                   emp.department_id, d.code
          ORDER BY overdue_unmarked DESC, emp.emp_display_name ASC`,
        [...this.analytics.baseParams(s), s.today],
      ),
      this.dataSource.query<
        Array<{ employee_id: number | null; attended: string; held: string }>
      >(
        `${ROSTER_CTE},
         ${MARKS_CTE}
         SELECT m.effective_employee_id AS employee_id,
                COUNT(*) FILTER (WHERE m.status IN ('present','late')) AS attended,
                COUNT(*) AS held
           FROM marks m
          GROUP BY m.effective_employee_id`,
        this.analytics.baseParams(s),
      ),
    ]);
    const byTeacher = new Map(
      presence.map((p) => [
        p.employee_id === null ? null : num(p.employee_id),
        { attended: num(p.attended), held: num(p.held) },
      ]),
    );
    return inventory.map((r) => {
      const id = r.employee_id === null ? null : num(r.employee_id);
      const marked = num(r.marked);
      const overdue = num(r.overdue_unmarked);
      const weeks = num(r.weeks);
      const past = marked + overdue;
      const pres = byTeacher.get(id) ?? { attended: 0, held: 0 };
      return {
        employee_id: id,
        emp_code: r.emp_code,
        emp_display_name: r.emp_display_name,
        department_id: r.department_id === null ? null : num(r.department_id),
        department_code: r.department_code,
        sessions: num(r.sessions),
        marked,
        overdue_unmarked: overdue,
        upcoming: num(r.upcoming),
        cancelled: num(r.cancelled),
        substituted_in: num(r.substituted_in),
        compliance_pct: pct(marked, past),
        weeks,
        sessions_per_week: weeks > 0 ? (round2(past / weeks) ?? 0) : 0,
        subjects: num(r.subjects),
        sections: num(r.sections),
        attended: pres.attended,
        held: pres.held,
        pct: pct(pres.attended, pres.held),
      };
    });
  }

  // --- leaves ---------------------------------------------------------------

  /**
   * Leave volume for the roster. The window is the dated range when one is
   * set, else from the earliest chosen semester's planned start to today, so
   * the rollup and the leave figures describe the same stretch of term.
   */
  async leaves(s: AttendanceScope): Promise<LeavesResult> {
    const from = s.from ?? s.windowStart;
    const to = s.to ?? s.today;
    const rosterCte = `
      WITH roster AS (
        SELECT s.id AS student_id, s.student_id AS roll_no, s.display_name,
               sg.attendance_group_id
          FROM students s
          JOIN student_groups sg ON sg.student_id = s.id
         WHERE sg.attendance_group_id = ANY($1::int[]) AND s.is_active = TRUE
      )`;
    const [byGroup, pending, top] = await Promise.all([
      this.dataSource.query<
        Array<{
          group_id: number;
          leave_type_id: number;
          leave_type: string;
          approved: string;
          pending: string;
          rejected: string;
          approved_days: string;
        }>
      >(
        `${rosterCte}
         SELECT r.attendance_group_id AS group_id, lt.id AS leave_type_id,
                lt.name AS leave_type,
                COUNT(*) FILTER (WHERE l.status IN ('approved','cancel_requested')) AS approved,
                COUNT(*) FILTER (WHERE l.status = 'pending') AS pending,
                COUNT(*) FILTER (WHERE l.status = 'rejected') AS rejected,
                COALESCE(SUM(
                  (LEAST(l.to_date, $3::date) - GREATEST(l.from_date, $2::date) + 1)
                ) FILTER (WHERE l.status IN ('approved','cancel_requested')), 0) AS approved_days
           FROM student_leaves l
           JOIN roster r ON r.student_id = l.student_id
           JOIN leave_types lt ON lt.id = l.leave_type_id
          WHERE l.from_date <= $3::date AND l.to_date >= $2::date
          GROUP BY r.attendance_group_id, lt.id, lt.name
          ORDER BY approved_days DESC`,
        [s.groupIds, from, to],
      ),
      this.dataSource.query<
        Array<{ count: string; oldest_days: string | null }>
      >(
        `${rosterCte}
         SELECT COUNT(*) AS count,
                MAX(($2::date - l.created_at::date)) AS oldest_days
           FROM student_leaves l
           JOIN roster r ON r.student_id = l.student_id
          WHERE l.status = 'pending'`,
        // Only the two parameters the query references — an unreferenced
        // positional parameter has no inferable type and Postgres rejects it.
        [s.groupIds, to],
      ),
      this.dataSource.query<
        Array<{
          student_id: number;
          roll_no: string;
          display_name: string;
          group_id: number;
          leaves: string;
          days: string;
        }>
      >(
        `${rosterCte}
         SELECT r.student_id, r.roll_no, r.display_name,
                r.attendance_group_id AS group_id,
                COUNT(*) AS leaves,
                SUM(LEAST(l.to_date, $3::date) - GREATEST(l.from_date, $2::date) + 1) AS days
           FROM student_leaves l
           JOIN roster r ON r.student_id = l.student_id
          WHERE l.status IN ('approved','cancel_requested')
            AND l.from_date <= $3::date AND l.to_date >= $2::date
          GROUP BY r.student_id, r.roll_no, r.display_name, r.attendance_group_id
          ORDER BY days DESC, leaves DESC
          LIMIT 25`,
        [s.groupIds, from, to],
      ),
    ]);
    return {
      window: { from, to },
      by_group: byGroup.map((r) => ({
        group_id: num(r.group_id),
        leave_type_id: num(r.leave_type_id),
        leave_type: r.leave_type,
        approved: num(r.approved),
        pending: num(r.pending),
        rejected: num(r.rejected),
        approved_days: num(r.approved_days),
      })),
      pending: {
        count: num(pending[0]?.count),
        oldest_days:
          pending[0]?.oldest_days === null || pending[0] === undefined
            ? null
            : num(pending[0].oldest_days),
      },
      top_students: top.map((r) => ({
        student_id: num(r.student_id),
        roll_no: r.roll_no,
        display_name: r.display_name,
        group_id: num(r.group_id),
        leaves: num(r.leaves),
        days: num(r.days),
      })),
    };
  }

  // --- internals ------------------------------------------------------------

  /** Session inventory split by (semester, section). NULL section = cross-group. */
  private async complianceSplit(s: AnalyticsScope): Promise<
    Array<{
      programme_semester_id: number;
      attendance_group_id: number | null;
      marked: number;
      overdue_unmarked: number;
      upcoming: number;
      cancelled: number;
    }>
  > {
    const rows = await this.dataSource.query<
      Array<{
        programme_semester_id: number;
        attendance_group_id: number | null;
        marked: string;
        overdue_unmarked: string;
        upcoming: string;
        cancelled: string;
      }>
    >(
      `${ROSTER_CTE},
       ${SCOPED_SESSIONS_CTE}
       SELECT ss.programme_semester_id, ss.attendance_group_id,
              COUNT(*) FILTER (WHERE ss.status = 'completed') AS marked,
              COUNT(*) FILTER (WHERE ss.status = 'scheduled' AND ss.session_date < $5::date) AS overdue_unmarked,
              COUNT(*) FILTER (WHERE ss.status = 'scheduled' AND ss.session_date >= $5::date) AS upcoming,
              COUNT(*) FILTER (WHERE ss.status = 'cancelled') AS cancelled
         FROM scoped_sessions ss
        GROUP BY ss.programme_semester_id, ss.attendance_group_id`,
      [...this.analytics.baseParams(s), s.today],
    );
    return rows.map((r) => ({
      programme_semester_id: num(r.programme_semester_id),
      attendance_group_id:
        r.attendance_group_id === null ? null : num(r.attendance_group_id),
      marked: num(r.marked),
      overdue_unmarked: num(r.overdue_unmarked),
      upcoming: num(r.upcoming),
      cancelled: num(r.cancelled),
    }));
  }

  /** student_id → attendance_group_id for the scope's groups. */
  async groupOfStudents(s: AnalyticsScope): Promise<Map<number, number>> {
    const rows = await this.dataSource.query<
      Array<{ student_id: number; attendance_group_id: number }>
    >(
      `SELECT sg.student_id, sg.attendance_group_id
         FROM student_groups sg
        WHERE sg.attendance_group_id = ANY($1::int[])`,
      [s.groupIds],
    );
    return new Map(
      rows.map((r) => [num(r.student_id), num(r.attendance_group_id)]),
    );
  }
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
