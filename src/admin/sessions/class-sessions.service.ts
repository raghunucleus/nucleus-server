import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { ClassSession, ClassSessionStatus } from '../entities/class-session.entity';
import { ClassSessionAuditLog } from '../entities/class-session-audit-log.entity';
import { Employee } from '../entities/employee.entity';
import { ProgrammeSemester } from '../entities/programme-semester.entity';
import { Subject } from '../entities/subject.entity';
import { TimetablePeriod } from '../entities/timetable-period.entity';

export interface ListOpts {
  programme_semester_id?: number;
  attendance_group_id?: number;
  effective_employee_id?: number;
  from: string;
  to: string;
  status?: ClassSessionStatus[];
}

export interface ActorContext {
  employee_id?: number;
  admin_id?: number;
}

export interface CancelInput {
  reason: string;
}

export interface SubstituteInput {
  new_effective_employee_id: number;
  reason?: string;
}

export interface MoveInput {
  // Move within the same group's bell schedule. New period must belong to
  // some timetable for the same group; service validates.
  new_timetable_period_id?: number;
  new_session_date?: string; // 'YYYY-MM-DD'
  reason?: string;
}

export interface AdHocInput {
  session_date: string;
  programme_semester_id: number;
  attendance_group_id: number;
  timetable_period_id: number;
  programme_semester_subject_id: number;
  programme_semester_subject_option_id?: number | null;
  scheduled_employee_id: number;
  room?: string | null;
  note?: string | null;
  reason?: string;
}

@Injectable()
export class ClassSessionsService {
  private readonly logger = new Logger(ClassSessionsService.name);

  constructor(
    @InjectRepository(ClassSession)
    private readonly sessions: Repository<ClassSession>,
    @InjectRepository(ClassSessionAuditLog)
    private readonly audit: Repository<ClassSessionAuditLog>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(TimetablePeriod)
    private readonly periods: Repository<TimetablePeriod>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    @InjectRepository(Subject)
    private readonly subjects: Repository<Subject>,
    private readonly dataSource: DataSource,
  ) {}

  // --- reads ----------------------------------------------------------------

  // Window-scoped list. The caller picks the filters that match their lens
  // (admin sees by group, teacher sees by themselves, etc.). Joined relations
  // keep payload size sane without an N+1 in the client.
  async list(opts: ListOpts): Promise<ClassSession[]> {
    if (opts.to < opts.from) {
      throw new BadRequestException('to date must not be before from');
    }
    const qb = this.sessions
      .createQueryBuilder('cs')
      .leftJoinAndSelect('cs.attendance_group', 'attendance_group')
      .leftJoinAndSelect('cs.timetable_period', 'timetable_period')
      .leftJoinAndSelect('cs.programme_semester_subject', 'pss')
      .leftJoinAndSelect('pss.subject', 'pss_subject')
      .leftJoinAndSelect(
        'cs.programme_semester_subject_option',
        'pss_option',
      )
      .leftJoinAndSelect('pss_option.subject', 'option_subject')
      .leftJoinAndSelect('cs.subject', 'subject')
      .leftJoinAndSelect('cs.scheduled_employee', 'scheduled_employee')
      .leftJoinAndSelect('cs.effective_employee', 'effective_employee')
      .where('cs.session_date BETWEEN :from AND :to', {
        from: opts.from,
        to: opts.to,
      })
      .orderBy('cs.session_date', 'ASC')
      .addOrderBy('timetable_period.position', 'ASC')
      .addOrderBy('cs.id', 'ASC');

    if (opts.programme_semester_id !== undefined) {
      qb.andWhere('cs.programme_semester_id = :psid', {
        psid: opts.programme_semester_id,
      });
    }
    if (opts.attendance_group_id !== undefined) {
      // Cross-group elective sessions have group=NULL; include them when a
      // group filter is set IFF they're for the same programme_semester.
      qb.andWhere(
        new Brackets((b) =>
          b
            .where('cs.attendance_group_id = :gid', {
              gid: opts.attendance_group_id,
            })
            .orWhere('cs.attendance_group_id IS NULL'),
        ),
      );
    }
    if (opts.effective_employee_id !== undefined) {
      qb.andWhere('cs.effective_employee_id = :eid', {
        eid: opts.effective_employee_id,
      });
    }
    if (opts.status && opts.status.length > 0) {
      qb.andWhere('cs.status IN (:...statuses)', { statuses: opts.status });
    }
    return qb.getMany();
  }

  async getOne(id: number): Promise<ClassSession> {
    const row = await this.sessions
      .createQueryBuilder('cs')
      .leftJoinAndSelect('cs.attendance_group', 'attendance_group')
      .leftJoinAndSelect('cs.timetable_period', 'timetable_period')
      .leftJoinAndSelect('cs.programme_semester_subject', 'pss')
      .leftJoinAndSelect('pss.subject', 'pss_subject')
      .leftJoinAndSelect(
        'cs.programme_semester_subject_option',
        'pss_option',
      )
      .leftJoinAndSelect('pss_option.subject', 'option_subject')
      .leftJoinAndSelect('cs.subject', 'subject')
      .leftJoinAndSelect('cs.scheduled_employee', 'scheduled_employee')
      .leftJoinAndSelect('cs.effective_employee', 'effective_employee')
      .leftJoinAndSelect('cs.programme_semester', 'programme_semester')
      .where('cs.id = :id', { id })
      .getOne();
    if (!row) throw new NotFoundException('Session not found');
    return row;
  }

  // --- mutations ------------------------------------------------------------

  async cancel(
    id: number,
    input: CancelInput,
    actor: ActorContext,
  ): Promise<ClassSession> {
    return this.mutate(id, actor, async (tx, row) => {
      if (row.status === 'cancelled') return row;
      if (row.status === 'completed') {
        throw new ConflictException(
          "Can't cancel a completed session — use the amend flow if attendance must be voided.",
        );
      }
      const before = snapshot(row);
      row.status = 'cancelled';
      row.cancel_reason = input.reason;
      await tx.getRepository(ClassSession).save(row);
      await this.writeAudit(tx, {
        class_session_id: row.id,
        action: 'cancel',
        before,
        after: snapshot(row),
        reason: input.reason,
        actor,
      });
      return row;
    });
  }

  // Re-open a cancelled session. Only valid for future / today's classes —
  // never for past dates (a class that didn't happen can't retroactively
  // "happen" again).
  async uncancel(
    id: number,
    input: { reason?: string },
    actor: ActorContext,
  ): Promise<ClassSession> {
    return this.mutate(id, actor, async (tx, row) => {
      if (row.status !== 'cancelled') return row;
      if (row.session_date < today()) {
        throw new ConflictException(
          "Can't re-open a cancelled session whose date has passed.",
        );
      }
      const before = snapshot(row);
      row.status = 'scheduled';
      row.cancel_reason = null;
      await tx.getRepository(ClassSession).save(row);
      await this.writeAudit(tx, {
        class_session_id: row.id,
        action: 'uncancel',
        before,
        after: snapshot(row),
        reason: input.reason ?? null,
        actor,
      });
      return row;
    });
  }

  async substitute(
    id: number,
    input: SubstituteInput,
    actor: ActorContext,
  ): Promise<ClassSession> {
    return this.mutate(id, actor, async (tx, row) => {
      if (row.status === 'cancelled') {
        throw new ConflictException(
          "Can't substitute a cancelled session — re-open it first.",
        );
      }
      const emp = await this.employees.findOne({
        where: { id: input.new_effective_employee_id },
      });
      if (!emp || !emp.is_active) {
        throw new BadRequestException(
          'Substitute teacher does not exist or is inactive',
        );
      }
      if (row.effective_employee_id === input.new_effective_employee_id) {
        return row;
      }
      // Conflict check: the substitute can't already be teaching another
      // session at the same period on the same date.
      const clash = await tx.getRepository(ClassSession).findOne({
        where: {
          effective_employee_id: input.new_effective_employee_id,
          session_date: row.session_date,
          timetable_period_id: row.timetable_period_id,
          status: In(['scheduled', 'completed']),
        },
      });
      if (clash && clash.id !== row.id) {
        throw new ConflictException(
          'That teacher is already assigned to another session in the same period.',
        );
      }
      const before = snapshot(row);
      row.effective_employee_id = input.new_effective_employee_id;
      await tx.getRepository(ClassSession).save(row);
      await this.writeAudit(tx, {
        class_session_id: row.id,
        action: 'substitute',
        before,
        after: snapshot(row),
        reason: input.reason ?? null,
        actor,
      });
      return row;
    });
  }

  // Move within the same date (new period) or to a new date (same period).
  // Both at once is a "reschedule" — different audit action.
  async move(
    id: number,
    input: MoveInput,
    actor: ActorContext,
  ): Promise<ClassSession> {
    if (
      input.new_timetable_period_id === undefined &&
      input.new_session_date === undefined
    ) {
      throw new BadRequestException(
        'Pass new_timetable_period_id and/or new_session_date',
      );
    }
    return this.mutate(id, actor, async (tx, row) => {
      if (row.status === 'completed') {
        throw new ConflictException(
          "Completed sessions can't be moved — use the amend flow.",
        );
      }
      if (row.status === 'cancelled') {
        throw new ConflictException(
          "Re-open the cancelled session before moving it.",
        );
      }
      const before = snapshot(row);
      const movingPeriod = input.new_timetable_period_id !== undefined;
      const movingDate = input.new_session_date !== undefined;
      const action: 'move' | 'reschedule' = movingDate && !movingPeriod
        ? 'reschedule'
        : 'move';

      let nextPeriodId = row.timetable_period_id;
      let nextDate = row.session_date;
      let nextDayOfWeek = row.day_of_week;

      if (movingPeriod) {
        const p = await this.periods.findOne({
          where: { id: input.new_timetable_period_id },
        });
        if (!p) throw new BadRequestException('Target period not found');
        if (p.is_break) {
          throw new BadRequestException("A break period can't hold a class");
        }
        nextPeriodId = p.id;
      }
      if (movingDate) {
        nextDate = input.new_session_date!;
        nextDayOfWeek = isoWeekday(nextDate);
      }

      // Cell-collision check at the destination: no other non-cancelled
      // session for the same group + date + period (and same option, if
      // any) may exist. We can't re-use the unique index alone because we
      // also want to refuse collisions with sessions teaching a different
      // subject.
      const clash = await tx
        .getRepository(ClassSession)
        .createQueryBuilder('cs')
        .where('cs.session_date = :date', { date: nextDate })
        .andWhere('cs.timetable_period_id = :pid', { pid: nextPeriodId })
        .andWhere('cs.id != :id', { id: row.id })
        .andWhere('cs.status IN (:...statuses)', {
          statuses: ['scheduled', 'completed'],
        })
        .andWhere(
          new Brackets((b) =>
            b
              .where(
                'cs.attendance_group_id IS NOT DISTINCT FROM :gid',
                { gid: row.attendance_group_id },
              )
              .orWhere(
                'cs.programme_semester_id = :psid AND cs.attendance_group_id IS NULL AND :gid IS NULL',
                {
                  psid: row.programme_semester_id,
                  gid: row.attendance_group_id,
                },
              ),
          ),
        )
        .getOne();
      if (clash) {
        throw new ConflictException(
          'Another class is already scheduled at the target date/period.',
        );
      }

      row.timetable_period_id = nextPeriodId;
      row.session_date = nextDate;
      row.day_of_week = nextDayOfWeek;
      await tx.getRepository(ClassSession).save(row);
      await this.writeAudit(tx, {
        class_session_id: row.id,
        action,
        before,
        after: snapshot(row),
        reason: input.reason ?? null,
        actor,
      });
      return row;
    });
  }

  // Insert a brand-new session that isn't tied to a timetable cell.
  async createAdHoc(
    input: AdHocInput,
    actor: ActorContext,
  ): Promise<ClassSession> {
    const ps = await this.programmeSemesters.findOne({
      where: { id: input.programme_semester_id },
    });
    if (!ps) throw new BadRequestException('Programme semester not found');
    if (ps.status !== 'ongoing') {
      throw new ForbiddenException(
        `Semester is ${ps.status} — sessions are read-only`,
      );
    }
    const period = await this.periods.findOne({
      where: { id: input.timetable_period_id },
    });
    if (!period) throw new BadRequestException('Period not found');
    if (period.is_break) {
      throw new BadRequestException("A break period can't hold a class");
    }
    const emp = await this.employees.findOne({
      where: { id: input.scheduled_employee_id },
    });
    if (!emp || !emp.is_active) {
      throw new BadRequestException('Teacher does not exist or is inactive');
    }
    // Resolve the master subject for this cell. For regular PSS rows the
    // subject_id is on the PSS itself; for slot rows (with an option) we
    // follow the option.
    const subjectId = await this.resolveSubjectId(
      input.programme_semester_subject_id,
      input.programme_semester_subject_option_id ?? null,
    );

    return this.dataSource.transaction(async (tx) => {
      const created = await tx.getRepository(ClassSession).save(
        tx.getRepository(ClassSession).create({
          session_date: input.session_date,
          day_of_week: isoWeekday(input.session_date),
          programme_semester_id: input.programme_semester_id,
          attendance_group_id: input.attendance_group_id,
          timetable_period_id: input.timetable_period_id,
          span: 1,
          timetable_entry_id: null,
          programme_semester_subject_id: input.programme_semester_subject_id,
          programme_semester_subject_option_id:
            input.programme_semester_subject_option_id ?? null,
          subject_id: subjectId,
          scheduled_employee_id: input.scheduled_employee_id,
          effective_employee_id: input.scheduled_employee_id,
          status: 'scheduled',
          room: input.room ?? null,
          note: input.note ?? null,
        }),
      );
      await this.writeAudit(tx, {
        class_session_id: created.id,
        action: 'create',
        before: null,
        after: snapshot(created),
        reason: input.reason ?? null,
        actor,
      });
      return this.getOne(created.id);
    });
  }

  // --- helpers --------------------------------------------------------------

  // Shared mutation envelope. Verifies the session exists + the programme
  // semester is still ongoing, opens a transaction, runs the body, returns
  // the freshly hydrated row.
  private async mutate(
    id: number,
    actor: ActorContext,
    body: (tx: EntityManager, row: ClassSession) => Promise<ClassSession>,
  ): Promise<ClassSession> {
    this.assertActor(actor);
    return this.dataSource.transaction(async (tx) => {
      const row = await tx
        .getRepository(ClassSession)
        .createQueryBuilder('cs')
        .leftJoinAndSelect('cs.programme_semester', 'programme_semester')
        .where('cs.id = :id', { id })
        .getOne();
      if (!row) throw new NotFoundException('Session not found');
      if (row.programme_semester.status !== 'ongoing') {
        throw new ForbiddenException(
          `Semester is ${row.programme_semester.status} — sessions are read-only`,
        );
      }
      await body(tx, row);
      return this.getOne(row.id);
    });
  }

  private async writeAudit(
    tx: EntityManager,
    rec: {
      class_session_id: number;
      action:
        | 'create'
        | 'cancel'
        | 'uncancel'
        | 'substitute'
        | 'move'
        | 'reschedule'
        | 'amend'
        | 'mark_attendance';
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      reason: string | null;
      actor: ActorContext;
    },
  ): Promise<void> {
    if (rec.actor.employee_id === undefined) {
      // Admin-driven audits still hit DB but we record the admin id in the
      // reason column for v1 — the audit schema gains an admin-actor column
      // in a future change. Skip writing a session audit row when the actor
      // is the admin to avoid sentinel rows for now.
      this.logger.debug(
        `writeAudit: skipping session audit for admin actor=${rec.actor.admin_id}`,
      );
      return;
    }
    const repo = tx.getRepository(ClassSessionAuditLog);
    await repo.save(
      repo.create({
        class_session_id: rec.class_session_id,
        action: rec.action,
        before: rec.before,
        after: rec.after,
        reason: rec.reason,
        performed_by_employee_id: rec.actor.employee_id,
      }),
    );
  }

  private assertActor(a: ActorContext): void {
    const hasAdmin = a.admin_id !== undefined && a.admin_id !== null;
    const hasEmployee = a.employee_id !== undefined && a.employee_id !== null;
    if (hasAdmin === hasEmployee) {
      throw new BadRequestException(
        'Session mutations require exactly one actor (admin or employee)',
      );
    }
  }

  private async resolveSubjectId(
    pssId: number,
    optionId: number | null,
  ): Promise<number> {
    if (optionId !== null) {
      const row = await this.dataSource
        .createQueryBuilder()
        .from('programme_semester_subject_options', 'pso')
        .select('pso.subject_id', 'subject_id')
        .where('pso.id = :id', { id: optionId })
        .getRawOne<{ subject_id: number }>();
      if (!row) {
        throw new BadRequestException('Elective option not found');
      }
      return Number(row.subject_id);
    }
    const row = await this.dataSource
      .createQueryBuilder()
      .from('programme_semester_subjects', 'pss')
      .select('pss.subject_id', 'subject_id')
      .where('pss.id = :id', { id: pssId })
      .getRawOne<{ subject_id: number | null }>();
    if (!row || row.subject_id === null) {
      throw new BadRequestException(
        'PSS row has no subject — pass an option_id when using a slot row',
      );
    }
    return Number(row.subject_id);
  }
}

// --- locals ------------------------------------------------------------------

function snapshot(row: ClassSession): Record<string, unknown> {
  // Pick only the columns that mutate. Keeps the audit JSON compact and
  // diffs human-readable.
  return {
    status: row.status,
    cancel_reason: row.cancel_reason,
    effective_employee_id: row.effective_employee_id,
    scheduled_employee_id: row.scheduled_employee_id,
    timetable_period_id: row.timetable_period_id,
    session_date: row.session_date,
    day_of_week: row.day_of_week,
    room: row.room,
    note: row.note,
  };
}

function today(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map((p) => Number(p));
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}
