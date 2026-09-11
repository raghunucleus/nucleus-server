import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { PermissionsService } from '../../../rbac/permissions.service';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { pct } from '../../../admin/sessions/student-attendance-query.service';
import { AttendanceAnalyticsService } from '../../attendance-analytics/attendance-analytics.service';
import { DRIVE_STUDENT_STATUS } from '../../drive-management/drive-student-status';
import { OverviewWindow, ScopeQuery } from '../dto/insights-query.dto';
import {
  INSIGHTS_SCREEN_KEYS,
  InsightsScope,
  InsightsScopeService,
} from '../insights-scope.service';
import { SCOPE_STUDENTS_CTE, num, pctInt, round2 } from '../insights.sql';
import { InsightsAttendanceService } from '../attendance/insights-attendance.service';
import { InsightsRequestsService } from '../requests/insights-requests.service';
import { InsightsResultsService } from '../results/insights-results.service';

const CACHE_TTL_SECONDS = 300;
const DEFAULT_WINDOW_DAYS: OverviewWindow = 30;
const TREND_WEEKS = 12;

export interface DomainLock {
  locked: true;
}

export interface OverviewAttendance {
  students: number;
  pct: number;
  below_threshold: number;
  below_condonation: number;
  compliance_pct: number;
  overdue_unmarked: number;
  basis_note: string;
}

export interface OverviewResults {
  avg_cgpa: number | null;
  with_current_backlogs: number;
  with_backlog_history: number;
  students_with_cgpa: number;
}

export interface OverviewPlacements {
  passout_year: number | null;
  cohort: number;
  eligible: number;
  placed: number;
  placed_pct: number;
  offers: number;
}

export interface OverviewRequests {
  pending: number;
  pending_over_7d: number;
}

export interface DepartmentComparisonRow {
  department_id: number;
  code: string;
  name: string;
  students: number;
  attendance_pct: number | null;
  below_threshold_pct: number | null;
  compliance_pct: number | null;
  avg_cgpa: number | null;
  backlog_pct: number | null;
  placed_pct: number | null;
}

export interface AttentionItem {
  kind: string;
  severity: 'high' | 'medium' | 'low';
  label: string;
  count: number;
  route: string;
  tab?: string;
}

/** Attendance over one rolling window (live session scan). */
export interface AttendanceWindowStats {
  pct: number;
  held: number;
  below_threshold: number;
  below_condonation: number;
  compliance_pct: number;
  overdue_unmarked: number;
}

export interface SemesterStats {
  students: number;
  avg_sgpa: number | null;
  pass_pct: number;
  with_backlogs: number;
}

export interface OverviewDeltas {
  window_days: number;
  /** Null when the previous window held no marked class — nothing to compare. */
  attendance: {
    current: AttendanceWindowStats;
    previous: AttendanceWindowStats;
    delta: Record<
      | 'pct'
      | 'below_threshold'
      | 'below_condonation'
      | 'compliance_pct'
      | 'overdue_unmarked',
      number
    >;
  } | null;
  /** Latest uploaded semester against the one before it, across the scope. */
  results: {
    latest_semester: number;
    previous_semester: number;
    current: SemesterStats;
    previous: SemesterStats;
    delta: Record<'avg_sgpa' | 'pass_pct' | 'with_backlogs', number | null>;
  } | null;
  placements: {
    current: { offers: number; placed_students: number };
    previous: { offers: number; placed_students: number };
    delta: Record<'offers' | 'placed_students', number>;
  } | null;
  requests: {
    current: { raised: number; decided: number };
    previous: { raised: number; decided: number };
    delta: Record<'raised' | 'decided', number>;
  } | null;
}

export interface OverviewResult {
  deltas: OverviewDeltas;
  scope: {
    departments: number;
    programmes: number;
    batches: number;
    sections: number;
    multi_department: boolean;
    today: string;
  };
  attendance: OverviewAttendance | DomainLock | null;
  results: OverviewResults | DomainLock | null;
  placements: OverviewPlacements | DomainLock | null;
  requests: OverviewRequests | DomainLock | null;
  by_department: DepartmentComparisonRow[] | null;
  attention: AttentionItem[];
  weekly_attendance: Array<{ week: string; pct: number; held: number }>;
  monthly_placements: Array<{
    month: string;
    offers: number;
    placed_students: number;
  }>;
  cached_at: string;
}

/**
 * The "what is happening" page: one summary per domain, a department
 * comparison when the scope spans several, and an attention feed.
 *
 * Every domain figure is computed only if the caller ALSO holds that domain's
 * screen — the overview grant is not a back door — and the whole payload is
 * cached in Redis for five minutes per (employee, narrowing): management
 * dashboards are read often and the underlying rollups move slowly.
 */
@Injectable()
export class InsightsOverviewService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    private readonly scopes: InsightsScopeService,
    private readonly analytics: AttendanceAnalyticsService,
    private readonly attendance: InsightsAttendanceService,
    private readonly results: InsightsResultsService,
    private readonly requests: InsightsRequestsService,
  ) {}

  async overview(
    employeeId: number,
    q: ScopeQuery & { window?: OverviewWindow },
  ): Promise<OverviewResult | null> {
    const window = q.window ?? DEFAULT_WINDOW_DAYS;
    const key = `insights:overview:${employeeId}:${createHash('sha1')
      .update(JSON.stringify({ ...q, window }))
      .digest('hex')}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as OverviewResult;

    const scope = await this.scopes.resolve(
      employeeId,
      INSIGHTS_SCREEN_KEYS.overview,
      q,
    );
    if (!scope) return null;

    const [hasAtt, hasRes, hasPl, hasReq] = await Promise.all(
      [
        INSIGHTS_SCREEN_KEYS.attendance,
        INSIGHTS_SCREEN_KEYS.results,
        INSIGHTS_SCREEN_KEYS.placements,
        INSIGHTS_SCREEN_KEYS.requests,
      ].map((k) => this.permissions.hasScreen(employeeId, k)),
    );

    const deptRows = new Map<number, DepartmentComparisonRow>(
      scope.departments
        .filter((d) => scope.batches.some((b) => b.department_id === d.id))
        .map((d) => [
          d.id,
          {
            department_id: d.id,
            code: d.code,
            name: d.name,
            students: scope.batches
              .filter((b) => b.department_id === d.id)
              .reduce((a, b) => a + b.student_count, 0),
            attendance_pct: null,
            below_threshold_pct: null,
            compliance_pct: null,
            avg_cgpa: null,
            backlog_pct: null,
            placed_pct: null,
          },
        ]),
    );
    const attention: AttentionItem[] = [];

    const [attendance, weekly, attendanceDelta] = hasAtt
      ? await this.attendanceBlock(scope, deptRows, attention, window)
      : [{ locked: true } as DomainLock, [], null];
    const results = hasRes
      ? await this.resultsBlock(scope, deptRows, attention)
      : ({ locked: true } as DomainLock);
    const [placements, monthly] = hasPl
      ? await this.placementsBlock(scope, deptRows, attention)
      : [{ locked: true } as DomainLock, []];
    const requests = hasReq
      ? await this.requestsBlock(scope, attention)
      : ({ locked: true } as DomainLock);
    const [resultsDelta, placementsDelta, requestsDelta] = await Promise.all([
      hasRes ? this.resultsDelta(scope) : Promise.resolve(null),
      hasPl ? this.placementsDelta(scope, window) : Promise.resolve(null),
      hasReq ? this.requestsDelta(scope, window) : Promise.resolve(null),
    ]);

    const severity = { high: 0, medium: 1, low: 2 };
    attention.sort((a, b) => severity[a.severity] - severity[b.severity]);

    const out: OverviewResult = {
      deltas: {
        window_days: window,
        attendance: attendanceDelta,
        results: resultsDelta,
        placements: placementsDelta,
        requests: requestsDelta,
      },
      scope: {
        departments: deptRows.size,
        programmes: new Set(scope.batches.map((b) => b.programme_id)).size,
        batches: scope.batches.length,
        sections: scope.groups.length,
        multi_department: scope.multiDepartment,
        today: scope.today,
      },
      attendance,
      results,
      placements,
      requests,
      by_department: scope.multiDepartment ? [...deptRows.values()] : null,
      attention,
      weekly_attendance: weekly,
      monthly_placements: monthly,
      cached_at: new Date().toISOString(),
    };
    await this.redis.set(key, JSON.stringify(out), 'EX', CACHE_TTL_SECONDS);
    return out;
  }

  // --- attendance -------------------------------------------------------

  private async attendanceBlock(
    scope: InsightsScope,
    depts: Map<number, DepartmentComparisonRow>,
    attention: AttentionItem[],
    window: number,
  ): Promise<
    [
      OverviewAttendance | null,
      OverviewResult['weekly_attendance'],
      OverviewDeltas['attendance'],
    ]
  > {
    const s = await this.attendance.resolve(scope, {});
    if (!s) return [null, [], null];
    const rollup = await this.attendance.rollup(s);

    // The two rolling windows: the last N days and the N before them. Both are
    // live session scans (adjustments excluded), so the headline tile keeps the
    // official whole-semester rollup and only the delta chip is windowed.
    const [current, previous] = await Promise.all([
      this.windowStats(s, shiftDays(s.today, -(window - 1)), s.today),
      this.windowStats(
        s,
        shiftDays(s.today, -(2 * window - 1)),
        shiftDays(s.today, -window),
      ),
    ]);
    const compliance = current.compliance;
    const daily = await this.analytics.daily(
      await this.analytics.buildScope(
        s.groupIds,
        s.psIds,
        s.locked,
        shiftDays(s.today, -(TREND_WEEKS * 7)),
        s.today,
      ),
      false,
    );
    const attendanceDelta: OverviewDeltas['attendance'] =
      previous.stats.held > 0
        ? {
            current: current.stats,
            previous: previous.stats,
            delta: {
              pct: round1(current.stats.pct - previous.stats.pct),
              below_threshold:
                current.stats.below_threshold - previous.stats.below_threshold,
              below_condonation:
                current.stats.below_condonation -
                previous.stats.below_condonation,
              compliance_pct: round1(
                current.stats.compliance_pct - previous.stats.compliance_pct,
              ),
              overdue_unmarked:
                current.stats.overdue_unmarked -
                previous.stats.overdue_unmarked,
            },
          }
        : null;

    for (const row of rollup.rows) {
      if (row.level !== 'department') continue;
      const d = depts.get(row.id);
      if (!d) continue;
      d.attendance_pct = row.held > 0 ? row.pct : null;
      d.below_threshold_pct =
        row.students > 0 ? pctInt(row.below_threshold, row.students) : null;
      d.compliance_pct =
        row.marked + row.overdue_unmarked > 0 ? row.compliance_pct : null;
    }

    if (compliance.overdue_unmarked > 0 && !s.locked) {
      attention.push({
        kind: 'overdue_unmarked',
        severity: 'high',
        label: `${compliance.overdue_unmarked} past classes in the last ${window} days are still unmarked`,
        count: compliance.overdue_unmarked,
        route: '/insights/attendance',
        tab: 'faculty',
      });
    }
    const weakSections = rollup.rows.filter(
      (r) => r.level === 'section' && r.held > 0 && r.pct < 65,
    );
    if (weakSections.length) {
      attention.push({
        kind: 'weak_sections',
        severity: 'high',
        label: `${weakSections.length} ${weakSections.length === 1 ? 'section averages' : 'sections average'} below 65% attendance`,
        count: weakSections.length,
        route: '/insights/attendance',
        tab: 'rollup',
      });
    }
    if (rollup.totals.below_condonation > 0) {
      attention.push({
        kind: 'below_condonation',
        severity: 'medium',
        label: `${rollup.totals.below_condonation} students are below the 65% condonation line`,
        count: rollup.totals.below_condonation,
        route: '/insights/attendance',
        tab: 'defaulters',
      });
    }
    const silent = await this.groupsWithoutSessionsThisWeek(
      s.groupIds,
      s.psIds,
      s.today,
    );
    if (silent > 0 && !s.locked) {
      attention.push({
        kind: 'no_timetable_this_week',
        severity: 'medium',
        label: `${silent} ${silent === 1 ? 'section has' : 'sections have'} no classes scheduled this week`,
        count: silent,
        route: '/insights/attendance',
        tab: 'rollup',
      });
    }

    const weeks = new Map<string, { attended: number; held: number }>();
    for (const d of daily.days) {
      const w = weekStart(d.session_date);
      const a = weeks.get(w) ?? { attended: 0, held: 0 };
      a.attended += d.attended;
      a.held += d.held;
      weeks.set(w, a);
    }
    const weekly = [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, a]) => ({
        week,
        pct: pct(a.attended, a.held),
        held: a.held,
      }));

    return [
      {
        students: rollup.totals.students,
        pct: rollup.totals.pct,
        below_threshold: rollup.totals.below_threshold,
        below_condonation: rollup.totals.below_condonation,
        compliance_pct: compliance.pct,
        overdue_unmarked: compliance.overdue_unmarked,
        basis_note: `Attendance is the whole-semester rollup; marking compliance and the change chips cover the last ${window} days against the ${window} before.`,
      },
      weekly,
      attendanceDelta,
    ];
  }

  /** Attendance + compliance for one dated window (sessions basis). */
  private async windowStats(
    s: { groupIds: number[]; psIds: number[]; locked: boolean },
    from: string,
    to: string,
  ): Promise<{
    stats: AttendanceWindowStats;
    compliance: Awaited<ReturnType<AttendanceAnalyticsService['compliance']>>;
  }> {
    const w = await this.analytics.buildScope(
      s.groupIds,
      s.psIds,
      s.locked,
      from,
      to,
    );
    const [students, compliance] = await Promise.all([
      this.analytics.students(w),
      this.analytics.compliance(w),
    ]);
    const attended = students.rows.reduce((a, r) => a + r.attended, 0);
    const held = students.rows.reduce((a, r) => a + r.held, 0);
    return {
      stats: {
        pct: pct(attended, held),
        held,
        below_threshold: students.rows.filter((r) => r.below_threshold).length,
        below_condonation: students.rows.filter((r) => r.below_condonation)
          .length,
        compliance_pct: compliance.pct,
        overdue_unmarked: compliance.overdue_unmarked,
      },
      compliance,
    };
  }

  // --- deltas -----------------------------------------------------------

  /** Latest uploaded semester vs the one before it, over the scope. */
  private async resultsDelta(
    scope: InsightsScope,
  ): Promise<OverviewDeltas['results']> {
    if (scope.payIds.length === 0) return null;
    const rows = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT g.semester,
              COUNT(*) AS students,
              AVG(g.sgpa) AS avg_sgpa,
              COUNT(*) FILTER (WHERE g.backlog_count = 0) AS passed,
              COUNT(*) FILTER (WHERE g.backlog_count > 0) AS with_backlogs
         FROM st
         JOIN student_semester_gpa g ON g.student_id = st.student_id
        GROUP BY g.semester
        ORDER BY g.semester DESC
        LIMIT 2`,
      [scope.payIds, scope.groupFilter],
    );
    if (rows.length < 2) return null;
    const stats = (r: Record<string, string>): SemesterStats => ({
      students: num(r.students),
      avg_sgpa: round2(r.avg_sgpa),
      pass_pct: pctInt(num(r.passed), num(r.students)),
      with_backlogs: num(r.with_backlogs),
    });
    const current = stats(rows[0]);
    const previous = stats(rows[1]);
    return {
      latest_semester: num(rows[0].semester),
      previous_semester: num(rows[1].semester),
      current,
      previous,
      delta: {
        avg_sgpa:
          current.avg_sgpa !== null && previous.avg_sgpa !== null
            ? round2(current.avg_sgpa - previous.avg_sgpa)
            : null,
        pass_pct: current.pass_pct - previous.pass_pct,
        with_backlogs: current.with_backlogs - previous.with_backlogs,
      },
    };
  }

  /** Selections recorded in the last N days vs the N before. */
  private async placementsDelta(
    scope: InsightsScope,
    window: number,
  ): Promise<OverviewDeltas['placements']> {
    if (scope.payIds.length === 0) return null;
    const curStart = shiftDays(scope.today, -(window - 1));
    const prevStart = shiftDays(scope.today, -(2 * window - 1));
    const [r] = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT COUNT(*) FILTER (WHERE ds.outcome_marked_at >= $3::date) AS cur_offers,
              COUNT(DISTINCT ds.student_id) FILTER (WHERE ds.outcome_marked_at >= $3::date) AS cur_students,
              COUNT(*) FILTER (WHERE ds.outcome_marked_at < $3::date) AS prev_offers,
              COUNT(DISTINCT ds.student_id) FILTER (WHERE ds.outcome_marked_at < $3::date) AS prev_students
         FROM drive_students ds
         JOIN st ON st.student_id = ds.student_id
        WHERE ds.status = ${DRIVE_STUDENT_STATUS.SELECTED}
          AND ds.outcome_marked_at >= $4::date`,
      [scope.payIds, scope.groupFilter, curStart, prevStart],
    );
    const current = {
      offers: num(r?.cur_offers),
      placed_students: num(r?.cur_students),
    };
    const previous = {
      offers: num(r?.prev_offers),
      placed_students: num(r?.prev_students),
    };
    return {
      current,
      previous,
      delta: {
        offers: current.offers - previous.offers,
        placed_students: current.placed_students - previous.placed_students,
      },
    };
  }

  /** Requests raised / decided in the last N days vs the N before. */
  private async requestsDelta(
    scope: InsightsScope,
    window: number,
  ): Promise<OverviewDeltas['requests']> {
    if (scope.payIds.length === 0) return null;
    const curStart = shiftDays(scope.today, -(window - 1));
    const prevStart = shiftDays(scope.today, -(2 * window - 1));
    const [r] = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT COUNT(*) FILTER (WHERE ar.created_at >= $3::date) AS cur_raised,
              COUNT(*) FILTER (WHERE ar.created_at >= $4::date AND ar.created_at < $3::date) AS prev_raised,
              COUNT(*) FILTER (WHERE ar.decided_at >= $3::date AND ar.status IN ('approved','rejected')) AS cur_decided,
              COUNT(*) FILTER (WHERE ar.decided_at >= $4::date AND ar.decided_at < $3::date AND ar.status IN ('approved','rejected')) AS prev_decided
         FROM approval_requests ar
         JOIN st ON st.student_id = ar.requester_student_id
        WHERE ar.created_at >= $4::date OR ar.decided_at >= $4::date`,
      [scope.payIds, scope.groupFilter, curStart, prevStart],
    );
    const current = {
      raised: num(r?.cur_raised),
      decided: num(r?.cur_decided),
    };
    const previous = {
      raised: num(r?.prev_raised),
      decided: num(r?.prev_decided),
    };
    return {
      current,
      previous,
      delta: {
        raised: current.raised - previous.raised,
        decided: current.decided - previous.decided,
      },
    };
  }

  private async groupsWithoutSessionsThisWeek(
    groupIds: number[],
    psIds: number[],
    today: string,
  ): Promise<number> {
    const from = weekStart(today);
    const to = shiftDays(from, 6);
    const [r] = await this.dataSource.query<Array<{ n: string }>>(
      `SELECT COUNT(*) AS n
         FROM attendance_groups g
        WHERE g.id = ANY($1::int[])
          AND NOT EXISTS (
            SELECT 1 FROM class_sessions cs
             WHERE cs.attendance_group_id = g.id
               AND cs.programme_semester_id = ANY($2::int[])
               AND cs.session_date BETWEEN $3::date AND $4::date)`,
      [groupIds, psIds, from, to],
    );
    return num(r?.n);
  }

  // --- results ----------------------------------------------------------

  private async resultsBlock(
    scope: InsightsScope,
    depts: Map<number, DepartmentComparisonRow>,
    attention: AttentionItem[],
  ): Promise<OverviewResults | null> {
    if (scope.payIds.length === 0) return null;
    const rows = await this.dataSource.query<Array<Record<string, string>>>(
      `${SCOPE_STUDENTS_CTE}
       SELECT p.department_id,
              COUNT(*) AS students,
              COUNT(c.id) AS with_cgpa,
              AVG(c.cgpa) AS avg_cgpa,
              COUNT(*) FILTER (WHERE COALESCE(st.current_backlogs, 0) > 0) AS with_current_backlogs,
              COUNT(*) FILTER (WHERE st.backlog_history) AS with_backlog_history
         FROM st
         JOIN programmes p ON p.id = st.programme_id
         LEFT JOIN student_cgpa c ON c.student_id = st.student_id
        GROUP BY p.department_id`,
      [scope.payIds, scope.groupFilter],
    );
    let withCgpa = 0;
    let cgpaSum = 0;
    let withBacklogs = 0;
    let withHistory = 0;
    for (const r of rows) {
      const n = num(r.students);
      const wc = num(r.with_cgpa);
      const avg = round2(r.avg_cgpa);
      withCgpa += wc;
      cgpaSum += (avg ?? 0) * wc;
      withBacklogs += num(r.with_current_backlogs);
      withHistory += num(r.with_backlog_history);
      const d = depts.get(num(r.department_id));
      if (d) {
        d.avg_cgpa = avg;
        d.backlog_pct = n > 0 ? pctInt(num(r.with_current_backlogs), n) : null;
      }
    }
    const gaps = (await this.results.coverage(scope)).filter((c) => c.gap);
    if (gaps.length) {
      attention.push({
        kind: 'results_missing',
        severity: 'medium',
        label: `${gaps.length} completed ${gaps.length === 1 ? 'semester has' : 'semesters have'} no results uploaded`,
        count: gaps.length,
        route: '/insights/results',
        tab: 'coverage',
      });
    }
    if (withBacklogs > 0) {
      attention.push({
        kind: 'backlogs',
        severity: 'low',
        label: `${withBacklogs} students carry current backlogs`,
        count: withBacklogs,
        route: '/insights/results',
        tab: 'backlogs',
      });
    }
    return {
      avg_cgpa: withCgpa > 0 ? round2(cgpaSum / withCgpa) : null,
      with_current_backlogs: withBacklogs,
      with_backlog_history: withHistory,
      students_with_cgpa: withCgpa,
    };
  }

  // --- placements -------------------------------------------------------

  private async placementsBlock(
    scope: InsightsScope,
    depts: Map<number, DepartmentComparisonRow>,
    attention: AttentionItem[],
  ): Promise<
    [OverviewPlacements | null, OverviewResult['monthly_placements']]
  > {
    if (scope.payIds.length === 0) return [null, []];
    const year = Number(scope.today.slice(0, 4));
    const upcoming = scope.batches
      .map((b) => b.passout_year)
      .filter((y) => y >= year)
      .sort((a, b) => a - b);
    const cohortYear = upcoming[0] ?? null;
    if (cohortYear === null) return [null, []];

    const S = DRIVE_STUDENT_STATUS;
    const [rows, monthly, closing] = await Promise.all([
      this.dataSource.query<Array<Record<string, string>>>(
        `${SCOPE_STUDENTS_CTE}
         SELECT p.department_id,
                COUNT(DISTINCT st.student_id) AS cohort,
                COUNT(DISTINCT st.student_id) FILTER (
                  WHERE COALESCE(st.allowed_by_dept_for_placements, TRUE)
                    AND COALESCE(st.interested_in_placements_self, TRUE)) AS eligible,
                COUNT(DISTINCT ds.student_id) AS placed,
                COUNT(ds.id) AS offers
           FROM st
           JOIN programmes p ON p.id = st.programme_id
           LEFT JOIN drive_students ds
             ON ds.student_id = st.student_id AND ds.status = ${S.SELECTED}
          WHERE st.pass_out_year = $3::int
          GROUP BY p.department_id`,
        [scope.payIds, scope.groupFilter, cohortYear],
      ),
      this.dataSource.query<Array<Record<string, string>>>(
        `${SCOPE_STUDENTS_CTE}
         SELECT to_char(date_trunc('month', ds.outcome_marked_at), 'YYYY-MM') AS month,
                COUNT(*) AS offers,
                COUNT(DISTINCT ds.student_id) AS placed_students
           FROM drive_students ds
           JOIN st ON st.student_id = ds.student_id
          WHERE ds.status = ${S.SELECTED} AND ds.outcome_marked_at IS NOT NULL
            AND st.pass_out_year = $3::int
          GROUP BY 1 ORDER BY 1`,
        [scope.payIds, scope.groupFilter, cohortYear],
      ),
      this.dataSource.query<Array<{ n: string }>>(
        `SELECT COUNT(*) AS n
           FROM drives d
          WHERE d.status = 'published'
            AND d.registration_end_date BETWEEN $1::date AND ($1::date + 7)`,
        [scope.today],
      ),
    ]);
    let cohort = 0;
    let eligible = 0;
    let placed = 0;
    let offers = 0;
    for (const r of rows) {
      cohort += num(r.cohort);
      eligible += num(r.eligible);
      placed += num(r.placed);
      offers += num(r.offers);
      const d = depts.get(num(r.department_id));
      if (d) {
        d.placed_pct =
          num(r.eligible) > 0 ? pctInt(num(r.placed), num(r.eligible)) : null;
      }
    }
    const closingSoon = num(closing[0]?.n);
    if (closingSoon > 0) {
      attention.push({
        kind: 'drives_closing',
        severity: 'low',
        label: `${closingSoon} published ${closingSoon === 1 ? 'drive closes' : 'drives close'} registration within a week`,
        count: closingSoon,
        route: '/insights/placements',
        tab: 'funnel',
      });
    }
    return [
      {
        passout_year: cohortYear,
        cohort,
        eligible,
        placed,
        placed_pct: pctInt(placed, eligible),
        offers,
      },
      monthly.map((r) => ({
        month: r.month,
        offers: num(r.offers),
        placed_students: num(r.placed_students),
      })),
    ];
  }

  // --- requests ---------------------------------------------------------

  private async requestsBlock(
    scope: InsightsScope,
    attention: AttentionItem[],
  ): Promise<OverviewRequests | null> {
    if (scope.payIds.length === 0) return null;
    const pending = await this.requests.pending(scope);
    const total = pending.reduce((a, r) => a + r.pending, 0);
    const over7 = pending.reduce((a, r) => a + r.over_7d, 0);
    if (over7 > 0) {
      attention.push({
        kind: 'requests_stale',
        severity: 'medium',
        label: `${over7} ${over7 === 1 ? 'request has' : 'requests have'} waited more than a week for a decision`,
        count: over7,
        route: '/insights/requests',
        tab: 'pending',
      });
    }
    return { pending: total, pending_over_7d: over7 };
  }
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Monday of the ISO week containing `iso`. */
function weekStart(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = d.getUTCDay();
  return shiftDays(iso.slice(0, 10), -(dow === 0 ? 6 : dow - 1));
}
