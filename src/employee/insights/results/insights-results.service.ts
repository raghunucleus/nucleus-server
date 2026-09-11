import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GRADES } from '../../exam-marks/exam-marks.constants';
import { bandFor } from '../../attendance-analytics/attendance-analytics.service';
import { InsightsScope } from '../insights-scope.service';
import { SCOPE_STUDENTS_CTE, num, numOrNull, round2 } from '../insights.sql';

/** SGPA / CGPA histogram bands — `min` inclusive, `max` exclusive. */
export const GPA_BANDS = [
  { key: 'lt5', label: 'Below 5', min: 0, max: 5 },
  { key: 'b5', label: '5 – 6', min: 5, max: 6 },
  { key: 'b6', label: '6 – 7', min: 6, max: 7 },
  { key: 'b7', label: '7 – 8', min: 7, max: 8 },
  { key: 'b8', label: '8 – 9', min: 8, max: 9 },
  { key: 'b9', label: '9 and above', min: 9, max: 11 },
] as const;

export function gpaBandFor(gpa: number): string {
  return GPA_BANDS.find((b) => gpa >= b.min && gpa < b.max)?.key ?? 'b9';
}

const GPA_BAND_SQL = (col: string) =>
  GPA_BANDS.map(
    (b) =>
      `COUNT(*) FILTER (WHERE ${col} >= ${b.min} AND ${col} < ${b.max}) AS band_${b.key}`,
  ).join(',\n              ');

const GRADE_SQL = GRADES.map(
  (g) => `COUNT(*) FILTER (WHERE r.grade = '${g}') AS grade_${g.toLowerCase()}`,
).join(',\n              ');

export interface BatchSemesterRow {
  pay_id: number;
  semester: number;
  students: number;
  passed: number;
  pass_pct: number;
  avg_sgpa: number | null;
  bands: Record<string, number>;
  backlogs: { none: number; one: number; two: number; three_plus: number };
  computed_at: string | null;
}

export interface SubjectResultRow {
  pay_id: number;
  semester: number;
  subject_code: string;
  subject_name: string;
  appeared: number;
  passed: number;
  fail_pct: number;
  first_attempt_failed: number;
  avg_grade_points: number | null;
  grades: Record<string, number>;
}

export interface CgpaResult {
  by_batch: Array<{
    pay_id: number;
    students: number;
    with_cgpa: number;
    avg_cgpa: number | null;
    median_cgpa: number | null;
    max_cgpa: number | null;
    with_current_backlogs: number;
    with_backlog_history: number;
    bands: Record<string, number>;
  }>;
  top_performers: Array<{
    student_id: number;
    roll_no: string;
    display_name: string;
    pay_id: number;
    cgpa: number;
    semesters_count: number;
    backlog_count: number;
  }>;
}

export interface BacklogsResult {
  min_backlogs: number;
  total: number;
  rows: Array<{
    student_id: number;
    roll_no: string;
    display_name: string;
    pay_id: number;
    cgpa: number | null;
    current_backlogs: number;
    backlog_history: boolean;
    semesters_count: number;
    worst_semester: number | null;
  }>;
}

export interface CoverageRow {
  pay_id: number;
  sem_number: number;
  status: string;
  planned_end_date: string | null;
  students: number;
  students_with_results: number;
  computed_at: string | null;
  /** A completed semester with no results uploaded. */
  gap: boolean;
}

export interface CorrelationResult {
  bands: Array<{
    band: string;
    students: number;
    avg_sgpa: number | null;
  }>;
  cells: Array<{ band: string; gpa_band: string; students: number }>;
  points: Array<{ pct: number; sgpa: number }>;
}

/**
 * University-results aggregates over the scope, read from the exam-marks
 * caches (`student_semester_gpa`, `student_cgpa`) and the best-attempt rows of
 * `student_exam_results`. Nothing here recomputes a GPA — the formulas live in
 * `ExamMarksService.commitUpload` and this screen must agree with the marks
 * view by construction.
 */
@Injectable()
export class InsightsResultsService {
  constructor(private readonly dataSource: DataSource) {}

  private params(scope: InsightsScope): [number[], number[] | null] {
    return [scope.payIds, scope.groupFilter];
  }

  /** Per batch × semester: pass %, average SGPA, SGPA histogram, backlog mix. */
  async batches(
    scope: InsightsScope,
    semester?: number,
  ): Promise<BatchSemesterRow[]> {
    if (scope.payIds.length === 0) return [];
    const rows = await this.dataSource.query<
      Array<Record<string, string> & { pay_id: number; semester: number }>
    >(
      `${SCOPE_STUDENTS_CTE}
       SELECT st.pay_id, g.semester,
              COUNT(*) AS students,
              COUNT(*) FILTER (WHERE g.backlog_count = 0) AS passed,
              AVG(g.sgpa) AS avg_sgpa,
              ${GPA_BAND_SQL('g.sgpa')},
              COUNT(*) FILTER (WHERE g.backlog_count = 0) AS bl_none,
              COUNT(*) FILTER (WHERE g.backlog_count = 1) AS bl_one,
              COUNT(*) FILTER (WHERE g.backlog_count = 2) AS bl_two,
              COUNT(*) FILTER (WHERE g.backlog_count >= 3) AS bl_three,
              MAX(g.computed_at)::text AS computed_at
         FROM st
         JOIN student_semester_gpa g ON g.student_id = st.student_id
        WHERE ($3::int IS NULL OR g.semester = $3::int)
        GROUP BY st.pay_id, g.semester
        ORDER BY st.pay_id, g.semester`,
      [...this.params(scope), semester ?? null],
    );
    return rows.map((r) => {
      const students = num(r.students);
      const passed = num(r.passed);
      return {
        pay_id: num(r.pay_id),
        semester: num(r.semester),
        students,
        passed,
        pass_pct: students ? Math.round((passed / students) * 1000) / 10 : 0,
        avg_sgpa: round2(r.avg_sgpa),
        bands: Object.fromEntries(
          GPA_BANDS.map((b) => [b.key, num(r[`band_${b.key}`])]),
        ),
        backlogs: {
          none: num(r.bl_none),
          one: num(r.bl_one),
          two: num(r.bl_two),
          three_plus: num(r.bl_three),
        },
        computed_at: r.computed_at ?? null,
      };
    });
  }

  /**
   * Per (batch, semester, subject): appeared, passed, fail %, grade mix and
   * how many failed at the first (regular) sitting even if they later cleared
   * it in supply — the number a subject review actually wants.
   */
  async subjects(
    scope: InsightsScope,
    semester?: number,
  ): Promise<SubjectResultRow[]> {
    if (scope.payIds.length === 0) return [];
    const rows = await this.dataSource.query<
      Array<Record<string, string> & { pay_id: number; semester: number }>
    >(
      `${SCOPE_STUDENTS_CTE}
       SELECT st.pay_id, r.semester, r.subject_code,
              MIN(r.subject_name) AS subject_name,
              COUNT(*) AS appeared,
              COUNT(*) FILTER (WHERE r.grade <> 'F') AS passed,
              AVG(r.grade_points) FILTER (WHERE r.grade <> 'P') AS avg_grade_points,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM student_exam_results r2
                 WHERE r2.student_id = r.student_id
                   AND r2.semester = r.semester
                   AND r2.subject_code = r.subject_code
                   AND r2.exam_type = 'regular'
                   AND r2.grade = 'F'
              )) AS first_attempt_failed,
              ${GRADE_SQL}
         FROM st
         JOIN student_exam_results r
           ON r.student_id = st.student_id AND r.is_best = TRUE
        WHERE ($3::int IS NULL OR r.semester = $3::int)
        GROUP BY st.pay_id, r.semester, r.subject_code
        ORDER BY st.pay_id, r.semester, r.subject_code`,
      [...this.params(scope), semester ?? null],
    );
    return rows.map((r) => {
      const appeared = num(r.appeared);
      const passed = num(r.passed);
      return {
        pay_id: num(r.pay_id),
        semester: num(r.semester),
        subject_code: r.subject_code,
        subject_name: r.subject_name,
        appeared,
        passed,
        fail_pct: appeared
          ? Math.round(((appeared - passed) / appeared) * 1000) / 10
          : 0,
        first_attempt_failed: num(r.first_attempt_failed),
        avg_grade_points: round2(r.avg_grade_points),
        grades: Object.fromEntries(
          GRADES.map((g) => [g, num(r[`grade_${g.toLowerCase()}`])]),
        ),
      };
    });
  }

  async cgpa(scope: InsightsScope): Promise<CgpaResult> {
    if (scope.payIds.length === 0) return { by_batch: [], top_performers: [] };
    const [byBatch, top] = await Promise.all([
      this.dataSource.query<Array<Record<string, string> & { pay_id: number }>>(
        `${SCOPE_STUDENTS_CTE}
         SELECT st.pay_id,
                COUNT(*) AS students,
                COUNT(c.id) AS with_cgpa,
                AVG(c.cgpa) AS avg_cgpa,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY c.cgpa) AS median_cgpa,
                MAX(c.cgpa) AS max_cgpa,
                COUNT(*) FILTER (WHERE COALESCE(st.current_backlogs, 0) > 0) AS with_current_backlogs,
                COUNT(*) FILTER (WHERE st.backlog_history) AS with_backlog_history,
                ${GPA_BAND_SQL('c.cgpa')}
           FROM st
           LEFT JOIN student_cgpa c ON c.student_id = st.student_id
          GROUP BY st.pay_id
          ORDER BY st.pay_id`,
        this.params(scope),
      ),
      this.dataSource.query<
        Array<{
          student_id: number;
          roll_no: string;
          display_name: string;
          pay_id: number;
          cgpa: string;
          semesters_count: number;
          backlog_count: number;
        }>
      >(
        `${SCOPE_STUDENTS_CTE}
         SELECT st.student_id, st.roll_no, st.display_name, st.pay_id,
                c.cgpa, c.semesters_count, c.backlog_count
           FROM st
           JOIN student_cgpa c ON c.student_id = st.student_id
          ORDER BY c.cgpa DESC, c.backlog_count ASC, st.roll_no ASC
          LIMIT 15`,
        this.params(scope),
      ),
    ]);
    return {
      by_batch: byBatch.map((r) => ({
        pay_id: num(r.pay_id),
        students: num(r.students),
        with_cgpa: num(r.with_cgpa),
        avg_cgpa: round2(r.avg_cgpa),
        median_cgpa: round2(r.median_cgpa),
        max_cgpa: round2(r.max_cgpa),
        with_current_backlogs: num(r.with_current_backlogs),
        with_backlog_history: num(r.with_backlog_history),
        bands: Object.fromEntries(
          GPA_BANDS.map((b) => [b.key, num(r[`band_${b.key}`])]),
        ),
      })),
      top_performers: top.map((r) => ({
        student_id: num(r.student_id),
        roll_no: r.roll_no,
        display_name: r.display_name,
        pay_id: num(r.pay_id),
        cgpa: num(r.cgpa),
        semesters_count: num(r.semesters_count),
        backlog_count: num(r.backlog_count),
      })),
    };
  }

  /** The risk list: students carrying at least `minBacklogs` current backlogs. */
  async backlogs(
    scope: InsightsScope,
    minBacklogs: number,
  ): Promise<BacklogsResult> {
    if (scope.payIds.length === 0) {
      return { min_backlogs: minBacklogs, total: 0, rows: [] };
    }
    const rows = await this.dataSource.query<
      Array<{
        total: string;
        student_id: number;
        roll_no: string;
        display_name: string;
        pay_id: number;
        cgpa: string | null;
        current_backlogs: number;
        backlog_history: boolean;
        semesters_count: number | null;
        worst_semester: number | null;
      }>
    >(
      `${SCOPE_STUDENTS_CTE}
       SELECT COUNT(*) OVER () AS total,
              st.student_id, st.roll_no, st.display_name, st.pay_id,
              c.cgpa, st.current_backlogs, st.backlog_history,
              c.semesters_count,
              (SELECT g.semester FROM student_semester_gpa g
                WHERE g.student_id = st.student_id
                ORDER BY g.backlog_count DESC, g.semester DESC LIMIT 1) AS worst_semester
         FROM st
         LEFT JOIN student_cgpa c ON c.student_id = st.student_id
        WHERE COALESCE(st.current_backlogs, 0) >= $3::int
        ORDER BY st.current_backlogs DESC, c.cgpa ASC NULLS LAST, st.roll_no ASC
        LIMIT 1000`,
      [...this.params(scope), minBacklogs],
    );
    return {
      min_backlogs: minBacklogs,
      total: num(rows[0]?.total),
      rows: rows.map((r) => ({
        student_id: num(r.student_id),
        roll_no: r.roll_no,
        display_name: r.display_name,
        pay_id: num(r.pay_id),
        cgpa: numOrNull(r.cgpa),
        current_backlogs: num(r.current_backlogs),
        backlog_history: !!r.backlog_history,
        semesters_count: num(r.semesters_count),
        worst_semester:
          r.worst_semester === null ? null : num(r.worst_semester),
      })),
    };
  }

  /** Which batch × semester has results at all — and which completed ones don't. */
  async coverage(scope: InsightsScope): Promise<CoverageRow[]> {
    if (scope.payIds.length === 0) return [];
    const rows = await this.dataSource.query<
      Array<{
        pay_id: number;
        sem_number: number;
        status: string;
        planned_end_date: string | null;
        students: string;
        students_with_results: string;
        computed_at: string | null;
      }>
    >(
      `${SCOPE_STUDENTS_CTE}
       SELECT sb.pay_id, sem.sem_number, ps.status,
              ps.planned_end_date::text AS planned_end_date,
              (SELECT COUNT(*) FROM st WHERE st.pay_id = sb.pay_id) AS students,
              (SELECT COUNT(*) FROM student_semester_gpa g
                 JOIN st ON st.student_id = g.student_id
                WHERE st.pay_id = sb.pay_id AND g.semester = sem.sem_number) AS students_with_results,
              (SELECT MAX(g.computed_at)::text FROM student_semester_gpa g
                 JOIN st ON st.student_id = g.student_id
                WHERE st.pay_id = sb.pay_id AND g.semester = sem.sem_number) AS computed_at
         FROM sb
         JOIN programme_semesters ps
           ON ps.programme_id = sb.programme_id
          AND ps.admission_year_id = sb.admission_year_id
         JOIN semesters sem ON sem.id = ps.semester_id
        WHERE ps.is_active = TRUE
        ORDER BY sb.pay_id, sem.sem_number`,
      this.params(scope),
    );
    return rows.map((r) => {
      const withResults = num(r.students_with_results);
      return {
        pay_id: num(r.pay_id),
        sem_number: num(r.sem_number),
        status: r.status,
        planned_end_date: r.planned_end_date,
        students: num(r.students),
        students_with_results: withResults,
        computed_at: r.computed_at,
        gap: r.status === 'completed' && withResults === 0,
      };
    });
  }

  /**
   * Attendance band vs latest SGPA for students with an ongoing semester. The
   * attendance side is the raw rollup (adjustments excluded) — a correlation
   * card, not an official figure; the official percentages are on the
   * attendance screen.
   */
  async attendanceCorrelation(
    scope: InsightsScope,
  ): Promise<CorrelationResult> {
    if (scope.payIds.length === 0) return { bands: [], cells: [], points: [] };
    const rows = await this.dataSource.query<
      Array<{ pct: string; sgpa: string }>
    >(
      `${SCOPE_STUDENTS_CTE},
       att AS (
         SELECT ssa.student_id,
                SUM(ssa.attended_count) AS attended, SUM(ssa.held_count) AS held
           FROM student_subject_attendance ssa
           JOIN programme_semesters ps
             ON ps.id = ssa.programme_semester_id AND ps.status = 'ongoing'
          WHERE ssa.student_id IN (SELECT student_id FROM st)
          GROUP BY ssa.student_id
         HAVING SUM(ssa.held_count) > 0
       ),
       gpa AS (
         SELECT DISTINCT ON (g.student_id) g.student_id, g.sgpa
           FROM student_semester_gpa g
          WHERE g.student_id IN (SELECT student_id FROM st)
          ORDER BY g.student_id, g.semester DESC
       )
       SELECT ROUND(100.0 * att.attended / att.held, 1) AS pct, gpa.sgpa
         FROM att JOIN gpa ON gpa.student_id = att.student_id`,
      this.params(scope),
    );
    const points = rows.map((r) => ({ pct: num(r.pct), sgpa: num(r.sgpa) }));
    const bandAgg = new Map<string, { n: number; sum: number }>();
    const cellAgg = new Map<string, number>();
    for (const p of points) {
      const band = bandFor(p.pct);
      const gb = gpaBandFor(p.sgpa);
      const a = bandAgg.get(band) ?? { n: 0, sum: 0 };
      a.n += 1;
      a.sum += p.sgpa;
      bandAgg.set(band, a);
      const ck = `${band}|${gb}`;
      cellAgg.set(ck, (cellAgg.get(ck) ?? 0) + 1);
    }
    // A scatter of thousands of dots is noise; a stride sample keeps the shape.
    const stride = Math.max(1, Math.ceil(points.length / 1500));
    return {
      bands: [...bandAgg.entries()].map(([band, a]) => ({
        band,
        students: a.n,
        avg_sgpa: round2(a.sum / a.n),
      })),
      cells: [...cellAgg.entries()].map(([k, students]) => {
        const [band, gpa_band] = k.split('|');
        return { band, gpa_band, students };
      }),
      points: points.filter((_, i) => i % stride === 0),
    };
  }
}
