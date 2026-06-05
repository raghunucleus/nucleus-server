import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClassSession } from '../../admin/entities/class-session.entity';
import {
  ActorContext,
  type AdHocInput,
  ClassSessionsService,
  type EditInput,
  type ListOpts,
} from '../../admin/sessions/class-sessions.service';
import { RosterService, type RosterStudent } from '../../admin/sessions/roster.service';
import { InchargeScheduleService } from './incharge-schedule.service';

/**
 * Day/week-of session management for an attendance group incharge. Wraps the
 * admin `ClassSessionsService` with group-ownership checks: the incharge can
 * only list / cancel / substitute / move sessions that belong to one of
 * their owned attendance groups.
 *
 * Ownership pivots on `attendance_group_incharges`
 * (resolved through [[InchargeScheduleService.ownedGroupIds]]). Cross-group
 * elective sessions (`attendance_group_id IS NULL`) are intentionally NOT
 * actionable here — they're admin-only territory because their cohort spans
 * multiple groups.
 *
 * The actor stamped on the audit log is the incharge employee, not an
 * admin — so the audit trail records who cancelled/substituted/moved a
 * given class.
 */
@Injectable()
export class InchargeSessionsService {
  constructor(
    @InjectRepository(ClassSession)
    private readonly sessions: Repository<ClassSession>,
    private readonly scheduleService: InchargeScheduleService,
    private readonly classSessions: ClassSessionsService,
    private readonly roster: RosterService,
  ) {}

  // --- reads ----------------------------------------------------------------

  /**
   * Sessions in a date window for one owned group. Always scoped — the
   * caller must pass `attendance_group_id`; passing one they don't own
   * throws Forbidden. We don't surface a "wildcard, all my groups" mode
   * because the UI is group-pinned.
   */
  async list(
    employeeId: number,
    attendanceGroupId: number,
    from: string,
    to: string,
    opts?: Pick<ListOpts, 'effective_employee_id' | 'status'>,
  ): Promise<ClassSession[]> {
    await this.requireOwnedGroup(employeeId, attendanceGroupId);
    return this.classSessions.list({
      from,
      to,
      attendance_group_id: attendanceGroupId,
      effective_employee_id: opts?.effective_employee_id,
      status: opts?.status,
    });
  }

  async getOne(employeeId: number, sessionId: number): Promise<ClassSession> {
    const row = await this.classSessions.getOne(sessionId);
    await this.requireOwnedSession(employeeId, row);
    return row;
  }

  /** Live-derived roster for one session (only for sessions in owned groups). */
  async getRoster(
    employeeId: number,
    sessionId: number,
  ): Promise<RosterStudent[]> {
    const row = await this.classSessions.getOne(sessionId);
    await this.requireOwnedSession(employeeId, row);
    return this.roster.forSession(sessionId);
  }

  /** Declared holidays overlapping [from, to] for one owned group — drives the
   *  "scheduling on a holiday" warning in the UI. */
  async listHolidays(
    employeeId: number,
    attendanceGroupId: number,
    from: string,
    to: string,
  ) {
    await this.requireOwnedGroup(employeeId, attendanceGroupId);
    return this.classSessions.holidaysForGroup(attendanceGroupId, from, to);
  }

  // --- mutations ------------------------------------------------------------

  async cancel(
    employeeId: number,
    sessionId: number,
    input: { reason: string },
  ): Promise<ClassSession> {
    await this.requireOwnedSessionById(employeeId, sessionId);
    return this.classSessions.cancel(sessionId, input, this.actor(employeeId));
  }

  async uncancel(
    employeeId: number,
    sessionId: number,
    input: { reason?: string },
  ): Promise<ClassSession> {
    await this.requireOwnedSessionById(employeeId, sessionId);
    return this.classSessions.uncancel(
      sessionId,
      input,
      this.actor(employeeId),
    );
  }

  async substitute(
    employeeId: number,
    sessionId: number,
    input: { new_effective_employee_id: number; reason?: string },
  ): Promise<ClassSession> {
    await this.requireOwnedSessionById(employeeId, sessionId);
    return this.classSessions.substitute(
      sessionId,
      input,
      this.actor(employeeId),
    );
  }

  async move(
    employeeId: number,
    sessionId: number,
    input: {
      new_timetable_period_id?: number;
      new_session_date?: string;
      allow_conflict?: boolean;
      allow_holiday?: boolean;
      reason?: string;
    },
  ): Promise<ClassSession> {
    const row = await this.requireOwnedSessionById(employeeId, sessionId);
    // A class can never be scheduled into the past — you can't hold a lesson
    // on a day that has already gone. We block on the *effective* target
    // date: the new date when one is supplied, otherwise the row's current
    // date (a period-only move on an already-past session is still a past
    // slot). Independent of whether the week has been published — see the
    // incharge schedule UI, which mirrors this with a `min` on the picker.
    const targetDate = input.new_session_date ?? row.session_date;
    if (targetDate < isoToday()) {
      throw new BadRequestException(
        "Can't reschedule a class into the past — pick today or a later date.",
      );
    }
    return this.classSessions.move(sessionId, input, this.actor(employeeId));
  }

  /**
   * Move several owned sessions to the same destination atomically — used to
   * reschedule an elective slot's option children as one unit. Every id must
   * belong to an owned group, and none may land in the past.
   */
  async moveMany(
    employeeId: number,
    sessionIds: number[],
    input: {
      new_timetable_period_id?: number;
      new_session_date?: string;
      allow_conflict?: boolean;
      allow_holiday?: boolean;
      reason?: string;
    },
  ): Promise<ClassSession[]> {
    const rows = await Promise.all(
      sessionIds.map((id) => this.requireOwnedSessionById(employeeId, id)),
    );
    const today = isoToday();
    for (const row of rows) {
      const targetDate = input.new_session_date ?? row.session_date;
      if (targetDate < today) {
        throw new BadRequestException(
          "Can't reschedule a class into the past — pick today or a later date.",
        );
      }
    }
    return this.classSessions.moveMany(
      sessionIds,
      input,
      this.actor(employeeId),
    );
  }

  /** In-place edit of a session's subject / teacher / room / note (not its
   *  date or period — use `move` for that). Group-ownership scoped. */
  async editSession(
    employeeId: number,
    sessionId: number,
    input: EditInput,
  ): Promise<ClassSession> {
    await this.requireOwnedSessionById(employeeId, sessionId);
    return this.classSessions.editSession(
      sessionId,
      input,
      this.actor(employeeId),
    );
  }

  /**
   * Push a one-off / makeup class for a single day in an owned group, not
   * tied to any timetable cell — useful for sudden changes. The session is
   * stamped `timetable_entry_id = NULL`, so a later week-republish keeps it.
   * Delegates the field validation (period not a break, teacher active,
   * semester ongoing, subject in this semester) to the admin service.
   */
  async createAdHoc(
    employeeId: number,
    input: AdHocInput,
  ): Promise<ClassSession> {
    await this.requireOwnedGroup(employeeId, input.attendance_group_id);
    return this.classSessions.createAdHoc(input, this.actor(employeeId));
  }

  // --- internals -----------------------------------------------------------

  private actor(employeeId: number): ActorContext {
    return { employee_id: employeeId };
  }

  private async requireOwnedGroup(
    employeeId: number,
    attendanceGroupId: number,
  ): Promise<void> {
    const owned = await this.scheduleService.ownedGroupIds(employeeId);
    if (!owned.includes(attendanceGroupId)) {
      throw new ForbiddenException(
        "You aren't the incharge of that attendance group.",
      );
    }
  }

  private async requireOwnedSessionById(
    employeeId: number,
    sessionId: number,
  ): Promise<ClassSession> {
    const row = await this.sessions.findOne({ where: { id: sessionId } });
    if (!row) throw new NotFoundException('Session not found');
    await this.requireOwnedSession(employeeId, row);
    return row;
  }

  private async requireOwnedSession(
    employeeId: number,
    row: ClassSession,
  ): Promise<void> {
    // Cross-group elective sessions (no concrete group) are admin-only —
    // the incharge contract is over attendance groups, not cohorts. We
    // refuse the action rather than silently pretending it isn't there.
    if (row.attendance_group_id === null) {
      throw new BadRequestException(
        "Cross-group elective sessions can't be managed from the incharge surface — ask an admin.",
      );
    }
    const owned = await this.scheduleService.ownedGroupIds(employeeId);
    if (!owned.includes(row.attendance_group_id)) {
      throw new ForbiddenException(
        "You aren't the incharge of that session's attendance group.",
      );
    }
  }
}

// Today as 'YYYY-MM-DD' in UTC. Matches `ClassSessionsService.today()` so the
// past-date guards across the move/uncancel flows stay consistent.
function isoToday(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
