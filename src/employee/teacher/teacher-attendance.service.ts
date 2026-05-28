import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClassSession } from '../../admin/entities/class-session.entity';
import { ClassSessionAttendance } from '../../admin/entities/class-session-attendance.entity';
import {
  AttendanceMarkingService,
  type AttendanceStatus,
  type MarkResult,
} from '../../admin/sessions/attendance-marking.service';
import { RosterService, type RosterStudent } from '../../admin/sessions/roster.service';

export interface TeacherSessionListItem {
  id: number;
  session_date: string;
  day_of_week: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  period: { id: number; label: string; start_time: string; end_time: string };
  span: number;
  subject: { id: number; code: string; name: string };
  is_elective: boolean;
  attendance_group: { id: number; name: string } | null;
  programme_semester_id: number;
  /** Programme of the cohort this session serves — drives the "B.Tech CSE" line on the card. */
  programme: { id: number; code: string; name: string; display_name: string } | null;
  /** Semester within the programme — e.g. `{ sem_number: 6, code: 'VI' }`. */
  semester: { id: number; sem_number: number; code: string } | null;
  /** Batch (admission year) — disambiguates between sections that share a semester. */
  admission_year: { id: number; year: number; display_year: string } | null;
  room: string | null;
  scheduled_employee_id: number;
  is_substitute: boolean;
  attendance_marked_at: string | null;
  roster_size: number | null;
  attended_count: number | null;
}

export interface RosterEntry extends RosterStudent {
  /** The student's existing mark on this session, or null when not yet marked. */
  current_status: AttendanceStatus | null;
}

export interface TeacherRosterResult {
  session_id: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
  attendance_marked_at: string | null;
  students: RosterEntry[];
}

export interface TeacherMarkInput {
  entries: { student_id: number; status: AttendanceStatus }[];
  allow_amend?: boolean;
}

/**
 * Teacher-self-scoped attendance queries + marking. Every method takes the
 * teacher's id from the controller (read from the JWT) and enforces that the
 * target session has `effective_employee_id = teacherId`. The intrinsic
 * "self-scope" replaces the per-attribute filter on the screen catalog.
 */
@Injectable()
export class TeacherAttendanceService {
  constructor(
    @InjectRepository(ClassSession)
    private readonly sessions: Repository<ClassSession>,
    @InjectRepository(ClassSessionAttendance)
    private readonly attendance: Repository<ClassSessionAttendance>,
    private readonly roster: RosterService,
    private readonly marking: AttendanceMarkingService,
  ) {}

  /**
   * Sessions on `date` where the calling teacher is the *effective* employee
   * (covers substitutes — the rollup keys on the subject, but the marking
   * screen is the substitute's responsibility). Returns enough metadata for
   * the list card without a follow-up roster fetch.
   */
  async listForDay(
    teacherId: number,
    date: string,
  ): Promise<TeacherSessionListItem[]> {
    const rows = await this.sessions
      .createQueryBuilder('cs')
      .leftJoinAndSelect('cs.attendance_group', 'attendance_group')
      .leftJoinAndSelect('cs.timetable_period', 'timetable_period')
      .leftJoinAndSelect('cs.subject', 'subject')
      .leftJoinAndSelect('cs.programme_semester', 'ps')
      .leftJoinAndSelect('ps.programme', 'programme')
      .leftJoinAndSelect('ps.semester', 'semester')
      .leftJoinAndSelect('ps.admission_year', 'admission_year')
      .where('cs.effective_employee_id = :eid', { eid: teacherId })
      .andWhere('cs.session_date = :d', { d: date })
      .orderBy('timetable_period.position', 'ASC')
      .addOrderBy('cs.id', 'ASC')
      .getMany();
    if (rows.length === 0) return [];

    // Roster + present-count for every session in one round-trip each, so the
    // list cards can show "32 / 45 marked" without a roster fetch per row.
    const ids = rows.map((r) => r.id);

    const attendanceCounts = await this.attendance
      .createQueryBuilder('csa')
      .select('csa.class_session_id', 'sid')
      .addSelect(
        `COUNT(*) FILTER (WHERE csa.status IN ('present', 'late'))`,
        'present',
      )
      .addSelect('COUNT(*)', 'marked')
      .where('csa.class_session_id IN (:...ids)', { ids })
      .groupBy('csa.class_session_id')
      .getRawMany<{ sid: string; present: string; marked: string }>();
    const countMap = new Map(
      attendanceCounts.map((r) => [
        Number(r.sid),
        { present: Number(r.present), marked: Number(r.marked) },
      ]),
    );

    // Roster size — derive only when no marks yet (otherwise marked >= roster
    // means we already have the denominator). Skipping the per-session roster
    // derivation here keeps the list fast; the marking screen re-derives.
    return rows.map((cs) => {
      const counts = countMap.get(cs.id);
      const rosterSize = counts && counts.marked > 0 ? counts.marked : null;
      return this.toListItem(cs, teacherId, rosterSize, counts?.present ?? null);
    });
  }

  /**
   * Shape the raw ClassSession (with joined relations) into the list-item
   * contract. Centralised so listForDay + listHistory stay in lock-step on
   * every field — the cards on both screens render from the same shape.
   */
  private toListItem(
    cs: ClassSession,
    teacherId: number,
    rosterSize: number | null,
    attendedCount: number | null,
  ): TeacherSessionListItem {
    const ps = cs.programme_semester;
    return {
      id: cs.id,
      session_date: cs.session_date,
      day_of_week: cs.day_of_week,
      status: cs.status,
      period: {
        id: cs.timetable_period.id,
        label: cs.timetable_period.label,
        start_time: cs.timetable_period.start_time,
        end_time: cs.timetable_period.end_time,
      },
      span: cs.span,
      subject: {
        id: cs.subject.id,
        code: cs.subject.code,
        name: cs.subject.name,
      },
      is_elective: cs.programme_semester_subject_option_id !== null,
      attendance_group: cs.attendance_group
        ? { id: cs.attendance_group.id, name: cs.attendance_group.name }
        : null,
      programme_semester_id: cs.programme_semester_id,
      programme: ps?.programme
        ? {
            id: ps.programme.id,
            code: ps.programme.code,
            name: ps.programme.name,
            display_name: ps.programme.display_name,
          }
        : null,
      semester: ps?.semester
        ? {
            id: ps.semester.id,
            sem_number: ps.semester.sem_number,
            code: ps.semester.code,
          }
        : null,
      admission_year: ps?.admission_year
        ? {
            id: ps.admission_year.id,
            year: ps.admission_year.year,
            display_year: ps.admission_year.display_year,
          }
        : null,
      room: cs.room,
      scheduled_employee_id: cs.scheduled_employee_id,
      is_substitute: cs.scheduled_employee_id !== teacherId,
      attendance_marked_at: cs.attendance_marked_at
        ? cs.attendance_marked_at.toISOString()
        : null,
      roster_size: rosterSize,
      attended_count: attendedCount,
    };
  }

  /**
   * Live roster for `sessionId` along with each student's existing mark (or
   * null if not yet marked). Throws ForbiddenException unless the calling
   * teacher is the session's effective employee.
   */
  async rosterFor(
    teacherId: number,
    sessionId: number,
  ): Promise<TeacherRosterResult> {
    const session = await this.requireOwnSession(teacherId, sessionId);

    const [students, existing] = await Promise.all([
      this.roster.forSession(sessionId),
      this.attendance.find({ where: { class_session_id: sessionId } }),
    ]);
    const markByStudent = new Map(
      existing.map((row) => [row.student_id, row.status] as const),
    );

    return {
      session_id: session.id,
      status: session.status,
      attendance_marked_at: session.attendance_marked_at
        ? session.attendance_marked_at.toISOString()
        : null,
      students: students.map((s) => ({
        ...s,
        current_status: markByStudent.get(s.id) ?? null,
      })),
    };
  }

  /**
   * Mark / amend attendance for `sessionId`. Delegates to the shared
   * AttendanceMarkingService but only after ownership is enforced — the
   * shared service trusts the actor; ownership is this layer's responsibility.
   */
  async mark(
    teacherId: number,
    sessionId: number,
    input: TeacherMarkInput,
  ): Promise<MarkResult> {
    await this.requireOwnSession(teacherId, sessionId);
    return this.marking.mark(
      sessionId,
      { entries: input.entries, allow_amend: input.allow_amend },
      { employee_id: teacherId },
    );
  }

  /**
   * Sessions in a date window, sorted forward (ASC). Drives the week view
   * on the teacher's "My timetable" screen — same row shape as the daily
   * list so the card components are reusable across both screens.
   */
  async listWeek(
    teacherId: number,
    weekStart: string,
    weekEnd: string,
  ): Promise<TeacherSessionListItem[]> {
    if (weekEnd < weekStart) {
      throw new ForbiddenException(
        'week_end must not be before week_start',
      );
    }
    return this.listInRange(teacherId, weekStart, weekEnd, 'ASC');
  }

  /**
   * `from..to` window of the teacher's previously marked sessions. Used by
   * the history screen; deliberately small surface — no editing here.
   */
  async listHistory(
    teacherId: number,
    from: string,
    to: string,
  ): Promise<TeacherSessionListItem[]> {
    if (to < from) {
      throw new ForbiddenException('to date must not be before from date');
    }
    return this.listInRange(teacherId, from, to, 'DESC');
  }

  /**
   * Shared sessions-in-range query. Used by both the week (ASC) and history
   * (DESC) screens. Filters by `effective_employee_id` so substitutes see
   * the sessions assigned to them.
   */
  private async listInRange(
    teacherId: number,
    from: string,
    to: string,
    dateOrder: 'ASC' | 'DESC',
  ): Promise<TeacherSessionListItem[]> {
    const rows = await this.sessions
      .createQueryBuilder('cs')
      .leftJoinAndSelect('cs.attendance_group', 'attendance_group')
      .leftJoinAndSelect('cs.timetable_period', 'timetable_period')
      .leftJoinAndSelect('cs.subject', 'subject')
      .leftJoinAndSelect('cs.programme_semester', 'ps')
      .leftJoinAndSelect('ps.programme', 'programme')
      .leftJoinAndSelect('ps.semester', 'semester')
      .leftJoinAndSelect('ps.admission_year', 'admission_year')
      .where('cs.effective_employee_id = :eid', { eid: teacherId })
      .andWhere('cs.session_date BETWEEN :from AND :to', { from, to })
      .orderBy('cs.session_date', dateOrder)
      .addOrderBy('timetable_period.position', 'ASC')
      .getMany();
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const counts = await this.attendance
      .createQueryBuilder('csa')
      .select('csa.class_session_id', 'sid')
      .addSelect(
        `COUNT(*) FILTER (WHERE csa.status IN ('present', 'late'))`,
        'present',
      )
      .addSelect('COUNT(*)', 'marked')
      .where('csa.class_session_id IN (:...ids)', { ids })
      .groupBy('csa.class_session_id')
      .getRawMany<{ sid: string; present: string; marked: string }>();
    const countMap = new Map(
      counts.map((r) => [
        Number(r.sid),
        { present: Number(r.present), marked: Number(r.marked) },
      ]),
    );

    return rows.map((cs) => {
      const c = countMap.get(cs.id);
      return this.toListItem(
        cs,
        teacherId,
        c ? c.marked : null,
        c ? c.present : null,
      );
    });
  }

  private async requireOwnSession(
    teacherId: number,
    sessionId: number,
  ): Promise<ClassSession> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.effective_employee_id !== teacherId) {
      throw new ForbiddenException(
        "This session isn't assigned to you. Only the effective teacher can view or mark it.",
      );
    }
    return session;
  }
}
