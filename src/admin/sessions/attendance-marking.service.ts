import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ClassSession } from '../entities/class-session.entity';
import { ClassSessionAttendance } from '../entities/class-session-attendance.entity';
import { ClassSessionAuditLog } from '../entities/class-session-audit-log.entity';
import { RosterService, type RosterStudent } from './roster.service';
import type { ActorContext } from './class-sessions.service';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'exempt'
  | 'od';

export interface MarkEntry {
  student_id: number;
  status: AttendanceStatus;
}

export interface MarkInput {
  entries: MarkEntry[];
  // When true, the session re-opens for editing and the rollup re-syncs.
  // Otherwise re-marking already-completed sessions is rejected — use the
  // amend flow for that.
  allow_amend?: boolean;
  // When an admin marks attendance on behalf of a teacher (e.g. the teacher
  // dictated the roster), the admin endpoint forwards the teacher's id here
  // so the marked_by stamp is honest. Ignored for employee-scope marking.
  on_behalf_of_employee_id?: number;
}

export interface MarkResult {
  session: ClassSession;
  attendance: ClassSessionAttendance[];
  roster_size: number;
}

const COUNTED_AS_PRESENT: AttendanceStatus[] = ['present', 'late'];

@Injectable()
export class AttendanceMarkingService {
  private readonly logger = new Logger(AttendanceMarkingService.name);

  constructor(
    @InjectRepository(ClassSession)
    private readonly sessions: Repository<ClassSession>,
    private readonly roster: RosterService,
    private readonly dataSource: DataSource,
  ) {}

  // Roster for the marking screen. Re-derived live so transfers since the
  // session was seeded reflect immediately.
  async rosterFor(sessionId: number): Promise<RosterStudent[]> {
    return this.roster.forSession(sessionId);
  }

  // Mark / re-mark attendance for one session. Inside one transaction:
  //   1. Validate session is markable.
  //   2. Re-derive the roster; reject student_ids outside it.
  //   3. Upsert class_session_attendance rows.
  //   4. Flip session status to 'completed' (first time only).
  //   5. Upsert student_subject_attendance rollup deltas.
  //   6. Write one mark_attendance audit row.
  async mark(
    sessionId: number,
    input: MarkInput,
    actor: ActorContext,
  ): Promise<MarkResult> {
    this.assertActor(actor);
    // The marking record needs an employee id stamped. When the actor is an
    // admin, fall back to `on_behalf_of_employee_id` so the row credits the
    // teacher rather than blank.
    const markerEmployeeId =
      actor.employee_id ?? input.on_behalf_of_employee_id;
    if (markerEmployeeId === undefined) {
      throw new ForbiddenException(
        'Admin marking requires on_behalf_of_employee_id (the teacher whose roster this represents).',
      );
    }
    return this.dataSource.transaction(async (tx) => {
      const session = await tx
        .getRepository(ClassSession)
        .createQueryBuilder('cs')
        .leftJoinAndSelect('cs.programme_semester', 'programme_semester')
        .where('cs.id = :id', { id: sessionId })
        .getOne();
      if (!session) throw new NotFoundException('Session not found');
      if (session.programme_semester.status !== 'ongoing') {
        throw new ForbiddenException(
          `Semester is ${session.programme_semester.status} — sessions are read-only`,
        );
      }
      if (session.status === 'cancelled') {
        throw new ConflictException(
          "Can't mark attendance on a cancelled session — re-open it first.",
        );
      }
      const isAmending = session.status === 'completed';
      if (isAmending && !input.allow_amend) {
        throw new ConflictException(
          'Session is already marked — pass allow_amend=true to edit.',
        );
      }

      const roster = await this.roster.forSession(sessionId);
      const rosterIds = new Set(roster.map((r) => r.id));
      const unknown = input.entries
        .map((e) => e.student_id)
        .filter((id) => !rosterIds.has(id));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `Students not on this session's roster: ${unknown.join(', ')}`,
        );
      }
      // Defensive dedupe — last entry wins if the client sent duplicates.
      const byStudent = new Map<number, AttendanceStatus>();
      for (const e of input.entries) byStudent.set(e.student_id, e.status);

      // Existing attendance (only relevant on amend) — used to compute the
      // delta on the rollup.
      const csaRepo = tx.getRepository(ClassSessionAttendance);
      const existing = await csaRepo.find({
        where: { class_session_id: sessionId },
      });
      const existingByStudent = new Map(
        existing.map((r) => [r.student_id, r] as const),
      );
      // Snapshot the original (pre-mutation) statuses so both the
      // amend-diff and the audit log's `before` payload see the OLD
      // values. The upsert loop below mutates `prior.status` in place
      // (since TypeORM tracks the entity by reference); without this
      // snapshot, the later diff would compare the new status against
      // itself and miss every flip — which silently broke the rollup
      // count on every absent→present amend.
      const originalStatusByStudent = new Map<number, AttendanceStatus>(
        existing.map((r) => [r.student_id, r.status] as const),
      );

      // Upsert one row per student in input.
      const now = new Date();
      const upserts: ClassSessionAttendance[] = [];
      for (const [studentId, status] of byStudent) {
        const prior = existingByStudent.get(studentId);
        if (prior) {
          prior.status = status;
          prior.marked_at = now;
          prior.marked_by_employee_id = actor.employee_id!;
          upserts.push(prior);
        } else {
          upserts.push(
            csaRepo.create({
              class_session_id: sessionId,
              student_id: studentId,
              status,
              marked_at: now,
              marked_by_employee_id: markerEmployeeId,
            }),
          );
        }
      }
      if (upserts.length > 0) {
        await csaRepo.save(upserts);
      }

      // Compute attended deltas per student for the rollup. On first mark
      // `held` increments by 1 for every student on roster; on amend we
      // leave `held` alone (the session was already counted) and only
      // adjust `attended` by the diff.
      const rosterArr = roster;
      const attendedDeltas = new Map<number, number>();
      const heldDeltas = new Map<number, number>();

      const wasCountedAs = (prior: AttendanceStatus | undefined): boolean =>
        prior !== undefined &&
        (COUNTED_AS_PRESENT as AttendanceStatus[]).includes(prior);
      const isCountedAs = (status: AttendanceStatus): boolean =>
        (COUNTED_AS_PRESENT as AttendanceStatus[]).includes(status);

      if (!isAmending) {
        // First-time mark — every roster student gets +1 held; +1 attended
        // if they were marked present/late.
        for (const r of rosterArr) {
          heldDeltas.set(r.id, 1);
          const status = byStudent.get(r.id);
          attendedDeltas.set(
            r.id,
            status !== undefined && isCountedAs(status) ? 1 : 0,
          );
        }
      } else {
        // Amend — recompute the diff per submitted student. Use the
        // pre-mutation snapshot above so was/now actually differ.
        for (const [studentId, status] of byStudent) {
          const priorStatus = originalStatusByStudent.get(studentId);
          const wasPresent = wasCountedAs(priorStatus);
          const nowPresent = isCountedAs(status);
          if (wasPresent === nowPresent) continue;
          attendedDeltas.set(
            studentId,
            (attendedDeltas.get(studentId) ?? 0) +
              (nowPresent ? 1 : -1),
          );
        }
      }

      await this.applyRollupDeltas(tx, {
        programme_semester_id: session.programme_semester_id,
        subject_id: session.subject_id,
        attendedDeltas,
        heldDeltas,
        lastSessionAt: now,
      });

      if (!isAmending) {
        session.status = 'completed';
        session.attendance_marked_at = now;
        await tx.getRepository(ClassSession).save(session);
      }

      // Audit row — one per mark/amend regardless of student count. The
      // `before` payload reads the pre-mutation snapshot so it captures
      // the ORIGINAL statuses (not the freshly-mutated `existing` rows).
      const auditRepo = tx.getRepository(ClassSessionAuditLog);
      await auditRepo.save(
        auditRepo.create({
          class_session_id: session.id,
          action: 'mark_attendance',
          before: isAmending
            ? {
                entries: Array.from(originalStatusByStudent.entries()).map(
                  ([student_id, status]) => ({ student_id, status }),
                ),
              }
            : null,
          after: {
            entries: upserts.map((r) => ({
              student_id: r.student_id,
              status: r.status,
            })),
          },
          reason: isAmending ? 'amend' : null,
          performed_by_employee_id: markerEmployeeId,
        }),
      );

      const fresh = await tx.getRepository(ClassSessionAttendance).find({
        where: { class_session_id: session.id },
      });
      return {
        session,
        attendance: fresh,
        roster_size: roster.length,
      };
    });
  }

  private async applyRollupDeltas(
    tx: EntityManager,
    rec: {
      programme_semester_id: number;
      subject_id: number;
      attendedDeltas: Map<number, number>;
      heldDeltas: Map<number, number>;
      lastSessionAt: Date;
    },
  ): Promise<void> {
    if (rec.attendedDeltas.size === 0 && rec.heldDeltas.size === 0) return;
    const studentIds = new Set<number>([
      ...rec.attendedDeltas.keys(),
      ...rec.heldDeltas.keys(),
    ]);
    // One round-trip per student keeps the SQL simple; volumes are bounded
    // by the session roster (~60). Postgres handles this in single-digit ms.
    for (const studentId of studentIds) {
      const attendedDelta = rec.attendedDeltas.get(studentId) ?? 0;
      const heldDelta = rec.heldDeltas.get(studentId) ?? 0;
      if (attendedDelta === 0 && heldDelta === 0) continue;
      await tx.query(
        `INSERT INTO "student_subject_attendance" (
           "student_id", "programme_semester_id", "subject_id",
           "attended_count", "held_count", "last_session_at"
         ) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT ("student_id", "programme_semester_id", "subject_id")
         DO UPDATE SET
           attended_count = student_subject_attendance.attended_count + EXCLUDED.attended_count,
           held_count     = student_subject_attendance.held_count     + EXCLUDED.held_count,
           last_session_at = EXCLUDED.last_session_at,
           updated_at = NOW()`,
        [
          studentId,
          rec.programme_semester_id,
          rec.subject_id,
          attendedDelta,
          heldDelta,
          rec.lastSessionAt,
        ],
      );
    }
  }

  private assertActor(a: ActorContext): void {
    const hasAdmin = a.admin_id !== undefined && a.admin_id !== null;
    const hasEmployee = a.employee_id !== undefined && a.employee_id !== null;
    if (hasAdmin === hasEmployee) {
      throw new BadRequestException(
        'Attendance marking requires exactly one actor (admin or employee)',
      );
    }
  }
}

