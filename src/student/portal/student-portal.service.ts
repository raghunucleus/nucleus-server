import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { Student } from '../../admin/entities/student.entity';

export interface SubjectAttendanceRow {
  subject_id: number;
  subject_code: string;
  subject_name: string;
  attended: number;
  held: number;
  pct: number;
  last_session_at: string | null;
}

export interface DashboardResult {
  programme_semester_id: number;
  semester_number: number | null;
  per_subject: SubjectAttendanceRow[];
  overall_attended: number;
  overall_held: number;
  overall_pct: number;
}

export interface WeekCell {
  date: string;
  day_of_week: number;
  timetable_period_id: number;
  period_label: string;
  start_time: string;
  end_time: string;
  span: number;
  session_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  is_elective: boolean;
  teacher_employee_id: number | null;
  teacher_display_name: string | null;
  // Truthy when effective ≠ scheduled — i.e. a substitute has been assigned.
  // The mobile UI uses this to badge the row so students see the swap, not
  // just a quietly-different teacher name.
  is_substitute: boolean;
  status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  cancel_reason: string | null;
  attendance_status: 'present' | 'absent' | 'late' | 'exempt' | 'od' | null;
  room: string | null;
}

export interface WeekBreakRow {
  position: number;
  label: string;
  start_time: string;
  end_time: string;
}

export interface WeekResult {
  week_start: string;
  week_end: string;
  // ISO weekdays the timetable runs on (1=Mon … 7=Sun).
  working_days: number[];
  // Break rows from the default timetable — rendered as gaps in the grid.
  breaks: WeekBreakRow[];
  cells: WeekCell[];
}

export interface SubjectSessionRow {
  session_id: number;
  date: string; // 'YYYY-MM-DD'
  day_of_week: number;
  period_label: string | null;
  start_time: string | null;
  end_time: string | null;
  // Session-level status — `cancelled` rows are kept so the student can
  // see that a class was cancelled (with the reason) instead of it
  // silently disappearing from the list.
  session_status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  cancel_reason: string | null;
  // The student's own mark for this session. `null` means the teacher
  // hasn't marked it yet (or the session is still in the future).
  attendance_status: 'present' | 'absent' | 'late' | 'exempt' | 'od' | null;
  is_substitute: boolean;
  teacher_display_name: string | null;
  room: string | null;
}

export interface SubjectSessionsResult {
  subject: { id: number; code: string; name: string };
  sessions: SubjectSessionRow[];
}

/**
 * Read-only queries that power the student timetable + attendance screens.
 * Every method takes the student id from the caller (controller) — never
 * from a route param or body.
 */
@Injectable()
export class StudentPortalService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    private readonly dataSource: DataSource,
  ) {}

  async dashboard(studentId: number): Promise<DashboardResult> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const ps = await this.findCurrentPs(student);

    const rows = await this.dataSource.query<
      Array<{
        subject_id: number;
        subject_code: string;
        subject_name: string;
        attended: string;
        held: string;
        last_session_at: string | null;
      }>
    >(
      `
      SELECT
        sub.id   AS subject_id,
        sub.code AS subject_code,
        sub.name AS subject_name,
        (COALESCE(ssa.attended_count, 0) + COALESCE(adj.attended_sum, 0))::int AS attended,
        (COALESCE(ssa.held_count,     0) + COALESCE(adj.held_sum,     0))::int AS held,
        ssa.last_session_at
      FROM "student_subject_attendance" ssa
      LEFT JOIN LATERAL (
        SELECT
          SUM(attended_delta)::int AS attended_sum,
          SUM(held_delta)::int     AS held_sum
        FROM "attendance_adjustments" a
        WHERE a.student_id = ssa.student_id
          AND a.programme_semester_id = ssa.programme_semester_id
          AND a.subject_id = ssa.subject_id
      ) adj ON TRUE
      JOIN "subjects" sub ON sub.id = ssa.subject_id
      WHERE ssa.student_id = $1
        AND ssa.programme_semester_id = $2
      ORDER BY sub.code ASC
      `,
      [studentId, ps.id],
    );

    const overallAdj = await this.dataSource.query<
      Array<{ attended_sum: string | null; held_sum: string | null }>
    >(
      `
      SELECT
        SUM(attended_delta)::int AS attended_sum,
        SUM(held_delta)::int     AS held_sum
      FROM "attendance_adjustments"
      WHERE student_id = $1
        AND programme_semester_id = $2
        AND subject_id IS NULL
      `,
      [studentId, ps.id],
    );

    const perSubject: SubjectAttendanceRow[] = rows.map((r) => {
      const attended = Number(r.attended);
      const held = Number(r.held);
      return {
        subject_id: Number(r.subject_id),
        subject_code: r.subject_code,
        subject_name: r.subject_name,
        attended,
        held,
        pct: pct(attended, held),
        last_session_at: r.last_session_at,
      };
    });

    const overallExtraAttended = Number(overallAdj[0]?.attended_sum ?? 0);
    const overallExtraHeld = Number(overallAdj[0]?.held_sum ?? 0);
    const overallAttended =
      perSubject.reduce((a, b) => a + b.attended, 0) + overallExtraAttended;
    const overallHeld =
      perSubject.reduce((a, b) => a + b.held, 0) + overallExtraHeld;

    return {
      programme_semester_id: ps.id,
      semester_number: ps.semester?.sem_number ?? null,
      per_subject: perSubject,
      overall_attended: overallAttended,
      overall_held: overallHeld,
      overall_pct: pct(overallAttended, overallHeld),
    };
  }

  /**
   * 7-day grid for the calling student. Includes class_sessions (so
   * cancellations / substitutions appear) joined with the student's own
   * attendance row. Also returns the bell schedule's break rows so the UI can
   * lay out a complete day; breaks are read from the group's default timetable.
   */
  async week(
    studentId: number,
    weekStart: string,
    weekEnd: string,
    dayOfWeek?: number,
  ): Promise<WeekResult> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    // Scope the bell-schedule lookup below to the student's current semester.
    // `is_default` is unique per (programme_semester_id, attendance_group_id),
    // so a group reused across semesters has one default per semester — without
    // this scope the join would return every past default's break rows too.
    const currentPs = await this.findCurrentPs(student);

    // Optional day filter — when set, the client only wants one day's
    // sessions (lazy per-day view). Added as a final `AND cs.day_of_week = $4`
    // and an empty string when absent, so the parameter count stays constant
    // and the planner can still use the day_of_week index when present.
    const dayClause = dayOfWeek !== undefined ? 'AND cs.day_of_week = $4' : '';
    const params: unknown[] =
      dayOfWeek !== undefined
        ? [studentId, weekStart, weekEnd, dayOfWeek]
        : [studentId, weekStart, weekEnd];

    const cells = await this.dataSource.query<WeekCell[]>(
      `
      WITH my_group AS (
        SELECT attendance_group_id
        FROM "student_groups"
        WHERE student_id = $1
      ),
      my_electives AS (
        SELECT
          pos.programme_semester_subject_option_id AS option_id,
          pos.employee_id
        FROM "programme_semester_subject_option_students" pos
        WHERE pos.student_id = $1
      )
      SELECT
        cs.session_date::text AS date,
        cs.day_of_week,
        cs.timetable_period_id,
        tp.label AS period_label,
        tp.start_time::text AS start_time,
        tp.end_time::text AS end_time,
        cs.span,
        cs.id AS session_id,
        cs.subject_id,
        sub.code AS subject_code,
        sub.name AS subject_name,
        (cs.programme_semester_subject_option_id IS NOT NULL) AS is_elective,
        cs.effective_employee_id AS teacher_employee_id,
        emp.emp_display_name AS teacher_display_name,
        (cs.effective_employee_id IS DISTINCT FROM cs.scheduled_employee_id) AS is_substitute,
        cs.status,
        cs.cancel_reason,
        csa.status AS attendance_status,
        cs.room
      FROM "class_sessions" cs
      JOIN "timetable_periods" tp ON tp.id = cs.timetable_period_id
      JOIN "subjects" sub ON sub.id = cs.subject_id
      LEFT JOIN "employees" emp ON emp.id = cs.effective_employee_id
      LEFT JOIN "class_session_attendance" csa
        ON csa.class_session_id = cs.id AND csa.student_id = $1
      WHERE cs.session_date BETWEEN $2 AND $3
        ${dayClause}
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
        )
      ORDER BY cs.session_date ASC, tp.position ASC
      `,
      params,
    );

    // The bell schedule (working days + break rows) comes from the group's
    // default timetable — same shape the admin schedule view uses.
    const meta = await this.dataSource.query<
      Array<{
        working_days: number[];
        position: number | null;
        label: string | null;
        start_time: string | null;
        end_time: string | null;
        is_break: boolean | null;
      }>
    >(
      `
      SELECT
        t.working_days,
        tp.position,
        tp.label,
        tp.start_time::text AS start_time,
        tp.end_time::text   AS end_time,
        tp.is_break
      FROM "student_groups" sg
      JOIN "timetables" t
        ON t.attendance_group_id = sg.attendance_group_id
       AND t.programme_semester_id = $2
       AND t.is_default = TRUE
      LEFT JOIN "timetable_periods" tp ON tp.timetable_id = t.id
      WHERE sg.student_id = $1
      ORDER BY tp.position ASC NULLS LAST
      `,
      [studentId, currentPs.id],
    );

    const workingDays =
      meta[0]?.working_days && Array.isArray(meta[0].working_days)
        ? meta[0].working_days
        : [1, 2, 3, 4, 5];
    const breaks: WeekBreakRow[] = meta
      .filter((r) => r.is_break && r.position !== null)
      .map((r) => ({
        position: Number(r.position),
        label: r.label ?? 'Break',
        start_time: r.start_time ?? '',
        end_time: r.end_time ?? '',
      }));

    return {
      week_start: weekStart,
      week_end: weekEnd,
      working_days: workingDays,
      breaks,
      cells: cells.map((c) => ({
        ...c,
        // pg-driver returns boolean as boolean, but be defensive across drivers.
        is_elective: Boolean(c.is_elective),
        is_substitute: Boolean(c.is_substitute),
      })),
    };
  }

  /**
   * Drill-down: every class_session for ONE subject that the calling
   * student was on the roster for, with their per-session attendance
   * mark. Drives the "tap a subject" view on the attendance dashboard —
   * the student sees each held / cancelled / upcoming class for that
   * subject, plus whether they were present.
   *
   * Mirrors the same group-vs-elective scoping as `week()`, so an
   * elective subject only returns the cohort the student is enrolled in
   * (not every parallel option).
   */
  async subjectSessions(
    studentId: number,
    subjectId: number,
  ): Promise<SubjectSessionsResult> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const ps = await this.findCurrentPs(student);

    const subjectRow = await this.dataSource.query<
      Array<{ id: number; code: string; name: string }>
    >(
      `SELECT id, code, name FROM "subjects" WHERE id = $1`,
      [subjectId],
    );
    if (subjectRow.length === 0) {
      throw new NotFoundException('Subject not found');
    }

    const rows = await this.dataSource.query<
      Array<{
        session_id: number;
        date: string;
        day_of_week: number;
        period_label: string | null;
        start_time: string | null;
        end_time: string | null;
        session_status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
        cancel_reason: string | null;
        attendance_status: SubjectSessionRow['attendance_status'];
        is_substitute: boolean;
        teacher_display_name: string | null;
        room: string | null;
      }>
    >(
      `
      WITH my_group AS (
        SELECT attendance_group_id
        FROM "student_groups"
        WHERE student_id = $1
      ),
      my_electives AS (
        SELECT
          pos.programme_semester_subject_option_id AS option_id,
          pos.employee_id
        FROM "programme_semester_subject_option_students" pos
        WHERE pos.student_id = $1
      )
      SELECT
        cs.id AS session_id,
        cs.session_date::text AS date,
        cs.day_of_week,
        tp.label AS period_label,
        tp.start_time::text AS start_time,
        tp.end_time::text AS end_time,
        cs.status AS session_status,
        cs.cancel_reason,
        csa.status AS attendance_status,
        (cs.effective_employee_id IS DISTINCT FROM cs.scheduled_employee_id) AS is_substitute,
        emp.emp_display_name AS teacher_display_name,
        cs.room
      FROM "class_sessions" cs
      JOIN "timetable_periods" tp ON tp.id = cs.timetable_period_id
      LEFT JOIN "employees" emp ON emp.id = cs.effective_employee_id
      LEFT JOIN "class_session_attendance" csa
        ON csa.class_session_id = cs.id AND csa.student_id = $1
      WHERE cs.subject_id = $2
        AND cs.programme_semester_id = $3
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
        )
      ORDER BY cs.session_date DESC, tp.position DESC
      `,
      [studentId, subjectId, ps.id],
    );

    return {
      subject: {
        id: Number(subjectRow[0].id),
        code: subjectRow[0].code,
        name: subjectRow[0].name,
      },
      sessions: rows.map((r) => ({
        session_id: Number(r.session_id),
        date: r.date,
        day_of_week: Number(r.day_of_week),
        period_label: r.period_label,
        start_time: r.start_time,
        end_time: r.end_time,
        session_status: r.session_status,
        cancel_reason: r.cancel_reason,
        attendance_status: r.attendance_status,
        is_substitute: Boolean(r.is_substitute),
        teacher_display_name: r.teacher_display_name,
        room: r.room,
      })),
    };
  }

  private async findCurrentPs(student: Student): Promise<ProgrammeSemester> {
    const row = await this.programmeSemesters
      .createQueryBuilder('ps')
      .leftJoinAndSelect('ps.semester', 'semester')
      .where('ps.programme_id = :pid', { pid: student.programme_id })
      .andWhere('ps.admission_year_id = :ayid', {
        ayid: student.admission_year_id,
      })
      .andWhere('ps.is_active = TRUE')
      .orderBy(
        `CASE WHEN ps.status = 'ongoing' THEN 0 WHEN ps.status = 'completed' THEN 1 ELSE 2 END`,
        'ASC',
      )
      .addOrderBy('ps.updated_at', 'DESC')
      .getOne();
    if (!row) {
      throw new NotFoundException(
        'No active programme semester for your batch yet',
      );
    }
    return row;
  }
}

function pct(attended: number, held: number): number {
  if (held <= 0) return 0;
  return Math.round((attended / held) * 1000) / 10;
}
