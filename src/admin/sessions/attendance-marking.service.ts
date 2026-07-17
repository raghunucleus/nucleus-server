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

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'exempt' | 'od';

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
  //   3. Upsert class_session_attendance rows (full roster on first mark).
  //   4. Flip session status to 'completed' (first time only).
  //   5. Recompute the student_subject_attendance rollup from those rows.
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

      // Persist one class_session_attendance row per student. On first mark we
      // write the FULL roster (any student the teacher didn't submit defaults
      // to 'absent') so class_session_attendance is the complete, authoritative
      // record of who was held — the rollup is recomputed from it below. On
      // amend we touch only the submitted students; their rows are updated in
      // place.
      const now = new Date();
      const targets: Array<{ id: number; status: AttendanceStatus }> =
        isAmending
          ? Array.from(byStudent, ([id, status]) => ({ id, status }))
          : roster.map((r) => ({
              id: r.id,
              status: byStudent.get(r.id) ?? 'absent',
            }));
      const upserts: ClassSessionAttendance[] = [];
      for (const { id: studentId, status } of targets) {
        const prior = existingByStudent.get(studentId);
        if (prior) {
          prior.status = status;
          prior.marked_at = now;
          prior.marked_by_employee_id = markerEmployeeId;
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

      // Flip to 'completed' BEFORE the recompute so this session is counted as
      // held in the projection below.
      if (!isAmending) {
        session.status = 'completed';
        session.attendance_marked_at = now;
        await tx.getRepository(ClassSession).save(session);
      }

      // Recompute the rollup for the affected students straight from
      // class_session_attendance. held = COUNT(rows on completed sessions),
      // attended = COUNT(present/late rows) — so attended can never exceed
      // held, and a roster change between first-mark and amend can no longer
      // drift the counts. (The old incremental-delta approach bumped `attended`
      // without `held` when a student joined the roster after first mark, which
      // produced impossible >100% values.)
      await this.recomputeRollup(tx, {
        programme_semester_id: session.programme_semester_id,
        subject_id: session.subject_id,
        studentIds: upserts.map((u) => u.student_id),
      });

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

  // Rebuild the (student × programme_semester × subject) rollup straight from
  // class_session_attendance for the given students — a pure projection, not an
  // increment. held = COUNT(rows on completed sessions), attended = COUNT of the
  // present/late ones, so attended <= held holds by construction and the cache
  // self-heals on every mark. Bounded by the session roster (~60 students) and
  // runs as a single statement.
  private async recomputeRollup(
    tx: EntityManager,
    rec: {
      programme_semester_id: number;
      subject_id: number;
      studentIds: number[];
    },
  ): Promise<void> {
    if (rec.studentIds.length === 0) return;
    await tx.query(
      `INSERT INTO "student_subject_attendance" (
         "student_id", "programme_semester_id", "subject_id",
         "attended_count", "held_count", "last_session_at"
       )
       SELECT
         csa."student_id",
         cs."programme_semester_id",
         cs."subject_id",
         COUNT(*) FILTER (WHERE csa."status" IN ('present','late'))::int,
         COUNT(*)::int,
         MAX(csa."marked_at")
       FROM "class_session_attendance" csa
       JOIN "class_sessions" cs ON cs."id" = csa."class_session_id"
       WHERE cs."programme_semester_id" = $1
         AND cs."subject_id" = $2
         AND cs."status" = 'completed'
         AND csa."student_id" = ANY($3::int[])
       GROUP BY csa."student_id", cs."programme_semester_id", cs."subject_id"
       ON CONFLICT ("student_id", "programme_semester_id", "subject_id")
       DO UPDATE SET
         attended_count  = EXCLUDED.attended_count,
         held_count      = EXCLUDED.held_count,
         last_session_at = EXCLUDED.last_session_at,
         updated_at      = NOW()`,
      [rec.programme_semester_id, rec.subject_id, rec.studentIds],
    );
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
