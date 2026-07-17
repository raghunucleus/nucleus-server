import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ClassSession } from '../entities/class-session.entity';
import { ProgrammeSemester } from '../entities/programme-semester.entity';
import { Student } from '../entities/student.entity';

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
  student_id: number;
  programme_semester_id: number;
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
  session_id: number | null;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  is_elective: boolean;
  teacher_employee_id: number | null;
  teacher_display_name: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  attendance_status: 'present' | 'absent' | 'late' | 'exempt' | 'od' | null;
  room: string | null;
}

@Injectable()
export class StudentAttendanceQueryService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    @InjectRepository(ClassSession)
    private readonly sessions: Repository<ClassSession>,
    private readonly dataSource: DataSource,
  ) {}

  // Per-subject + overall % for the student's current (or supplied) ongoing
  // programme_semester. Reads the rollup and folds in attendance_adjustments
  // deltas in one round-trip.
  async dashboard(
    studentId: number,
    programmeSemesterId?: number,
  ): Promise<DashboardResult> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const psId = programmeSemesterId ?? (await this.findCurrentPsId(student));

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
      [studentId, psId],
    );

    // Overall-only adjustments (subject_id NULL on the ledger row).
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
      [studentId, psId],
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
      student_id: studentId,
      programme_semester_id: psId,
      per_subject: perSubject,
      overall_attended: overallAttended,
      overall_held: overallHeld,
      overall_pct: pct(overallAttended, overallHeld),
    };
  }

  // 7-day grid for a student. Reads class_sessions (so cancellations /
  // substitutions appear) joined with the student's class_session_attendance
  // row. The session roster derivation is centralised in RosterService — but
  // here we do the inverse (which sessions include this student?), which is
  // a simpler direct query: regular sessions match by group; elective
  // sessions match by option_students.
  async week(
    studentId: number,
    weekStart: string,
    weekEnd: string,
  ): Promise<WeekCell[]> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    return this.dataSource.query<WeekCell[]>(
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
        cs.status,
        csa.status AS attendance_status,
        cs.room
      FROM "class_sessions" cs
      JOIN "timetable_periods" tp ON tp.id = cs.timetable_period_id
      JOIN "subjects" sub ON sub.id = cs.subject_id
      LEFT JOIN "employees" emp ON emp.id = cs.effective_employee_id
      LEFT JOIN "class_session_attendance" csa
        ON csa.class_session_id = cs.id AND csa.student_id = $1
      WHERE cs.session_date BETWEEN $2 AND $3
        AND (
          -- regular sessions for the student's current group
          (cs.programme_semester_subject_option_id IS NULL
           AND cs.attendance_group_id = (SELECT attendance_group_id FROM my_group))
          OR
          -- elective sessions whose cohort the student belongs to
          (cs.programme_semester_subject_option_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM my_electives me
             WHERE me.option_id = cs.programme_semester_subject_option_id
               AND me.employee_id = cs.scheduled_employee_id
           ))
        )
      ORDER BY cs.session_date ASC, tp.position ASC
      `,
      [studentId, weekStart, weekEnd],
    );
  }

  // Find the student's current 'ongoing' programme_semester. If none is
  // ongoing, falls back to the most recent completed one — useful for
  // start-of-semester views before the admin has flipped status.
  private async findCurrentPsId(student: Student): Promise<number> {
    const row = await this.programmeSemesters
      .createQueryBuilder('ps')
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
        'No active programme semester for this student',
      );
    }
    return row.id;
  }
}

function pct(attended: number, held: number): number {
  if (held <= 0) return 0;
  return Math.round((attended / held) * 1000) / 10;
}
