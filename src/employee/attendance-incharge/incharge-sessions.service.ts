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
  ClassSessionsService,
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
 * Ownership pivots on `attendance_groups.group_incharge_employee_id`
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
      reason?: string;
    },
  ): Promise<ClassSession> {
    await this.requireOwnedSessionById(employeeId, sessionId);
    return this.classSessions.move(sessionId, input, this.actor(employeeId));
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
