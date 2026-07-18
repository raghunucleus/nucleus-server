import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { StudentNotificationService } from '../../student/notification/student-notification.service';
import { StudentApprovalsSyncService } from '../../student/approvals/student-approvals-sync.service';
import { StudentSearchDto } from '../../student-query/dto/student-search.dto';
import { StudentQueryService } from '../../student-query/student-query.service';
import {
  DRIVE_STUDENT_STATUS,
  DriveStudentAction,
  DriveStudentOutcome,
  REVOCABLE_STATUSES,
} from './drive-student-status';
import { Drive } from './entities/drive.entity';
import { DriveStudent } from './entities/drive-student.entity';
import { DriveStudentEvent } from './entities/drive-student-event.entity';
import { MAX_IMPORT_STUDENT_IDS } from './dto/import-drive-students.dto';

/** The ceiling on "import all matched" — a drive shortlist is realistically
 *  hundreds; over this the user is asked to narrow the filter instead. */
const MAX_IMPORT_ALL = MAX_IMPORT_STUDENT_IDS;

export interface DriveImportSummary {
  /** Newly added to the drive by this call. */
  imported: number;
  /** Requested ids already in the drive (skipped). */
  already_existed: number;
  /** Total ids processed (imported + already_existed). */
  requested: number;
}

export interface DriveInviteSummary {
  /** Rows moved 10 → 20 by this call. */
  invited: number;
  /** Requested ids not at status 10 (already invited / responded / unknown). */
  skipped: number;
  requested: number;
}

export interface DriveOutcomeSummary {
  /** Rows moved 30 → the outcome by this call. */
  updated: number;
  /** Requested ids not at status 30. */
  skipped: number;
  requested: number;
}

export interface DriveRemindSummary {
  /** Invited students re-notified by this call. */
  reminded: number;
  /** Requested ids not currently Invited (skipped). */
  skipped: number;
  requested: number;
}

export interface DriveRevokeSummary {
  /** Rows moved 20/30 → 80 by this call. */
  revoked: number;
  /** Requested ids not in a revocable state (skipped). */
  skipped: number;
  requested: number;
}

export interface DriveStudentTrackEvent {
  id: number;
  action: string;
  from_status: number | null;
  to_status: number;
  reason: string | null;
  actor_type: string;
  actor_name: string | null;
  created_at: Date;
}

export interface DriveStudentTrack {
  student: { id: number; roll_no: string; display_name: string };
  current_status: number;
  events: DriveStudentTrackEvent[];
}

export interface DriveStudentRow {
  /** Student PK. */
  id: number;
  roll_no: string;
  display_name: string;
  programme: string | null;
  imported_at: Date;
  imported_by: string | null;
  status: number;
  invited_at: Date | null;
  responded_at: Date | null;
  rejection_reason: string | null;
  outcome_marked_at: Date | null;
}

export interface DriveStudentsPage {
  rows: DriveStudentRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * The drive's persisted shortlist (the "Students" tab) and its import from the
 * Filter tab. Membership is duplicate-safe: {@link import_} skips students
 * already in the drive and reports them as `already_existed` rather than erroring.
 *
 * Gated by `drive_management.drives.manage` (institution-wide screen, no
 * per-attribute scope), so imports run the search engine without an RBAC scope
 * object — exactly like the Filter tab it draws from.
 */
@Injectable()
export class DriveStudentsService {
  constructor(
    @InjectRepository(DriveStudent)
    private readonly repo: Repository<DriveStudent>,
    @InjectRepository(DriveStudentEvent)
    private readonly eventsRepo: Repository<DriveStudentEvent>,
    @InjectRepository(Drive)
    private readonly driveRepo: Repository<Drive>,
    private readonly engine: StudentQueryService,
    private readonly notifications: StudentNotificationService,
    private readonly approvalsSync: StudentApprovalsSyncService,
  ) {}

  /** Append audit-trail rows — one per transitioned drive-student. */
  private async logEvents(
    entries: {
      drive_student_id: number;
      from_status: number | null;
      to_status: number;
    }[],
    action: DriveStudentAction,
    actorType: 'employee' | 'student' | 'system',
    opts: { actorEmployeeId?: number | null; reason?: string | null } = {},
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.eventsRepo.insert(
      entries.map((e) => ({
        drive_student_id: e.drive_student_id,
        action,
        from_status: e.from_status,
        to_status: e.to_status,
        actor_type: actorType,
        actor_employee_id: opts.actorEmployeeId ?? null,
        reason: opts.reason ?? null,
      })),
    );
  }

  /** The `student_id` set currently in the drive — used to annotate Filter rows
   *  and to dedupe imports. */
  async memberIds(driveId: number): Promise<Set<number>> {
    const rows = await this.repo.find({
      where: { drive_id: driveId },
      select: { student_id: true },
    });
    return new Set(rows.map((r) => r.student_id));
  }

  /** Add explicit student ids to the drive, skipping any already present. */
  async import_(
    driveId: number,
    employeeId: number,
    studentIds: number[],
  ): Promise<DriveImportSummary> {
    await this.assertDrive(driveId);

    // Distinct, in case the caller sent the same id twice.
    const wanted = [...new Set(studentIds)];
    const existing = await this.memberIds(driveId);
    const fresh = wanted.filter((id) => !existing.has(id));

    if (fresh.length > 0) {
      // orIgnore is a race safety net — a concurrent import racing the same
      // student hits the unique constraint and is silently dropped.
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(DriveStudent)
        .values(
          fresh.map((student_id) => ({
            drive_id: driveId,
            student_id,
            imported_by_employee_id: employeeId,
          })),
        )
        .orIgnore()
        .execute();

      // Audit: one 'imported' event per freshly-created row (re-read the ids,
      // since orIgnore doesn't reliably return them).
      const inserted = await this.repo.find({
        where: { drive_id: driveId, student_id: In(fresh) },
        select: { id: true },
      });
      await this.logEvents(
        inserted.map((r) => ({
          drive_student_id: r.id,
          from_status: null,
          to_status: DRIVE_STUDENT_STATUS.IMPORTED,
        })),
        'imported',
        'employee',
        { actorEmployeeId: employeeId },
      );
    }

    return {
      imported: fresh.length,
      already_existed: wanted.length - fresh.length,
      requested: wanted.length,
    };
  }

  /** Import every student matching the Filter tab's current query. */
  async importAll(
    driveId: number,
    employeeId: number,
    dto: StudentSearchDto,
  ): Promise<DriveImportSummary> {
    await this.assertDrive(driveId);

    // Synchronous probe: re-validates the filters and bounds the set up front,
    // mirroring the export path.
    const probe = await this.engine.search(
      { ...dto, skip_pagination: false, page: 1, pageSize: 1, format: 'json' },
      { surface: 'employee' },
    );
    if (probe.total > MAX_IMPORT_ALL) {
      throw new BadRequestException(
        `Too many students to import at once (${probe.total.toLocaleString('en-US')}, max ${MAX_IMPORT_ALL.toLocaleString('en-US')}). Narrow the filters.`,
      );
    }

    const all = await this.engine.search(
      { ...dto, skip_pagination: true, page: 1, format: 'json' },
      { surface: 'employee' },
    );
    const ids = all.rows
      .map((r) => Number(r.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (ids.length === 0) {
      return { imported: 0, already_existed: 0, requested: 0 };
    }
    return this.import_(driveId, employeeId, ids);
  }

  /**
   * Invite (or re-invite) explicit student ids → 20 with a notification. Valid
   * from Imported (10, first invite), Denied (40, reinvite after the student
   * rejected) or Revoked (80, reinvite after we pulled the invite); a reinvite
   * resets the lifecycle fields so the row starts clean (the full history stays
   * in the audit log). Only a published drive may invite. The `status IN`
   * predicate is both the transition validation and the race guard.
   */
  async invite(
    driveId: number,
    employeeId: number,
    studentIds: number[],
  ): Promise<DriveInviteSummary> {
    const drive = await this.assertDrive(driveId);
    if (drive.status !== 'published') {
      throw new BadRequestException(
        'Invites can only be sent from a published drive.',
      );
    }

    const invitable = [
      DRIVE_STUDENT_STATUS.IMPORTED,
      DRIVE_STUDENT_STATUS.DENIED,
      DRIVE_STUDENT_STATUS.REVOKED,
    ];
    const wanted = [...new Set(studentIds)];
    // Pre-fetch so the audit event's from_status is accurate (10 vs 80).
    const targets = await this.repo.find({
      where: {
        drive_id: driveId,
        student_id: In(wanted),
        status: In(invitable),
      },
      select: { id: true, student_id: true, status: true },
    });
    if (targets.length === 0) {
      return { invited: 0, skipped: wanted.length, requested: wanted.length };
    }

    const result = await this.repo
      .createQueryBuilder()
      .update(DriveStudent)
      .set({
        status: DRIVE_STUDENT_STATUS.INVITED,
        invited_at: () => 'now()',
        invited_by_employee_id: employeeId,
        // Reset the rest of the lifecycle — a reinvite starts fresh at Invited.
        responded_at: null,
        rejection_reason: null,
        revoked_at: null,
        revoked_by_employee_id: null,
        outcome_marked_at: null,
        outcome_marked_by_employee_id: null,
      })
      .where('id IN (:...ids)', { ids: targets.map((t) => t.id) })
      .andWhere('status IN (:...from)', { from: invitable })
      .returning(['id', 'student_id'])
      .execute();

    const rows = result.raw as { id: number; student_id: number }[];
    const invitedIds = rows.map((r) => r.student_id);
    const fromById = new Map(targets.map((t) => [t.id, t.status]));
    await this.logEvents(
      rows.map((r) => ({
        drive_student_id: r.id,
        from_status: fromById.get(r.id) ?? null,
        to_status: DRIVE_STUDENT_STATUS.INVITED,
      })),
      'invited',
      'employee',
      { actorEmployeeId: employeeId },
    );
    // Mirror the transition into the student approvals inbox (→ pending).
    await this.approvalsSync.syncDrivePlacements(
      rows.map((r) => ({
        student_id: r.student_id,
        drive_student_id: r.id,
        drive_status: DRIVE_STUDENT_STATUS.INVITED,
      })),
    );
    if (invitedIds.length > 0) {
      // One send() call — the service fans out per recipient itself. Failures
      // must not fail the invite (the rows are already at 20).
      void this.notifications
        .send(invitedIds, {
          module: 'placements',
          type: 'drive-invite',
          title: 'Placement drive invitation',
          body: `You are invited to ${drive.drive_name}. Accept or deny it in Placements.`,
          target: { type: 'drive-invite', id: driveId },
        })
        .catch(() => undefined);
    }

    return {
      invited: invitedIds.length,
      skipped: wanted.length - invitedIds.length,
      requested: wanted.length,
    };
  }

  /** Invite every still-Imported (status 10) student in the drive. */
  async inviteAll(
    driveId: number,
    employeeId: number,
  ): Promise<DriveInviteSummary> {
    const rows = await this.repo.find({
      where: { drive_id: driveId, status: DRIVE_STUDENT_STATUS.IMPORTED },
      select: { student_id: true },
    });
    if (rows.length === 0) {
      await this.assertDrive(driveId);
      return { invited: 0, skipped: 0, requested: 0 };
    }
    return this.invite(
      driveId,
      employeeId,
      rows.map((r) => r.student_id),
    );
  }

  /**
   * Nudge Invited students who haven't responded — re-sends the invitation
   * notification without changing status, and records a 'reminded' audit event.
   */
  async remind(
    driveId: number,
    employeeId: number,
    studentIds: number[],
  ): Promise<DriveRemindSummary> {
    const drive = await this.assertDrive(driveId);
    const wanted = [...new Set(studentIds)];
    const targets = await this.repo.find({
      where: {
        drive_id: driveId,
        student_id: In(wanted),
        status: DRIVE_STUDENT_STATUS.INVITED,
      },
      select: { id: true, student_id: true },
    });
    if (targets.length === 0) {
      return { reminded: 0, skipped: wanted.length, requested: wanted.length };
    }

    await this.logEvents(
      targets.map((t) => ({
        drive_student_id: t.id,
        from_status: DRIVE_STUDENT_STATUS.INVITED,
        to_status: DRIVE_STUDENT_STATUS.INVITED,
      })),
      'reminded',
      'employee',
      { actorEmployeeId: employeeId },
    );
    void this.notifications
      .send(
        targets.map((t) => t.student_id),
        {
          module: 'placements',
          type: 'drive-invite',
          title: 'Reminder: placement drive invitation',
          body: `Reminder — you're invited to ${drive.drive_name}. Accept or deny it in Placements.`,
          target: { type: 'drive-invite', id: driveId },
        },
      )
      .catch(() => undefined);

    return {
      reminded: targets.length,
      skipped: wanted.length - targets.length,
      requested: wanted.length,
    };
  }

  /**
   * Record the drive-day outcome for ACCEPTED students: 30 → 50/60/70. Only
   * Selected notifies — a rejection shouldn't be broken via a push title; the
   * others surface in-app.
   */
  async markOutcome(
    driveId: number,
    employeeId: number,
    studentIds: number[],
    status: DriveStudentOutcome,
  ): Promise<DriveOutcomeSummary> {
    const drive = await this.assertDrive(driveId);

    const wanted = [...new Set(studentIds)];
    const result = await this.repo
      .createQueryBuilder()
      .update(DriveStudent)
      .set({
        status,
        outcome_marked_at: () => 'now()',
        outcome_marked_by_employee_id: employeeId,
      })
      .where('drive_id = :driveId', { driveId })
      .andWhere('student_id IN (:...ids)', { ids: wanted })
      .andWhere('status = :from', { from: DRIVE_STUDENT_STATUS.ACCEPTED })
      .returning(['id', 'student_id'])
      .execute();

    const rows = result.raw as { id: number; student_id: number }[];
    const updatedIds = rows.map((r) => r.student_id);
    await this.logEvents(
      rows.map((r) => ({
        drive_student_id: r.id,
        from_status: DRIVE_STUDENT_STATUS.ACCEPTED,
        to_status: status,
      })),
      'outcome',
      'employee',
      { actorEmployeeId: employeeId },
    );
    if (updatedIds.length > 0 && status === DRIVE_STUDENT_STATUS.SELECTED) {
      void this.notifications
        .send(updatedIds, {
          module: 'placements',
          type: 'drive-outcome',
          title: 'Congratulations — you have been selected!',
          body: `You were selected in ${drive.drive_name}. See the details in Placements.`,
          target: { type: 'drive-outcome', id: driveId },
        })
        .catch(() => undefined);
    }

    return {
      updated: updatedIds.length,
      skipped: wanted.length - updatedIds.length,
      requested: wanted.length,
    };
  }

  /** The drive's shortlist for the Students tab. */
  async list(
    driveId: number,
    opts: { page: number; pageSize: number; search?: string; status?: number },
  ): Promise<DriveStudentsPage> {
    await this.assertDrive(driveId);
    const page = Math.max(1, opts.page);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize));

    const qb = this.repo
      .createQueryBuilder('ds')
      .innerJoin('students', 's', 's.id = ds.student_id')
      .leftJoin('programmes', 'p', 'p.id = s.programme_id')
      .leftJoin('employees', 'e', 'e.id = ds.imported_by_employee_id')
      .where('ds.drive_id = :driveId', { driveId });

    const search = opts.search?.trim();
    if (search) {
      qb.andWhere('(s.display_name ILIKE :q OR s.student_id ILIKE :q)', {
        q: `%${search}%`,
      });
    }
    if (opts.status !== undefined) {
      qb.andWhere('ds.status = :status', { status: opts.status });
    }

    const total = await qb.getCount();

    const raw = await qb
      .select('ds.student_id', 'id')
      .addSelect('s.student_id', 'roll_no')
      .addSelect('s.display_name', 'display_name')
      .addSelect('p.display_name', 'programme')
      .addSelect('ds.imported_at', 'imported_at')
      .addSelect('e.emp_display_name', 'imported_by')
      .addSelect('ds.status', 'status')
      .addSelect('ds.invited_at', 'invited_at')
      .addSelect('ds.responded_at', 'responded_at')
      .addSelect('ds.rejection_reason', 'rejection_reason')
      .addSelect('ds.outcome_marked_at', 'outcome_marked_at')
      .orderBy('ds.imported_at', 'DESC')
      .addOrderBy('ds.student_id', 'DESC')
      .offset((page - 1) * pageSize)
      .limit(pageSize)
      .getRawMany<{
        id: number;
        roll_no: string;
        display_name: string;
        programme: string | null;
        imported_at: Date;
        imported_by: string | null;
        status: number;
        invited_at: Date | null;
        responded_at: Date | null;
        rejection_reason: string | null;
        outcome_marked_at: Date | null;
      }>();

    return {
      rows: raw.map((r) => ({
        id: Number(r.id),
        roll_no: r.roll_no,
        display_name: r.display_name,
        programme: r.programme,
        imported_at: r.imported_at,
        imported_by: r.imported_by,
        status: Number(r.status),
        invited_at: r.invited_at,
        responded_at: r.responded_at,
        rejection_reason: r.rejection_reason,
        outcome_marked_at: r.outcome_marked_at,
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * Revoke Invited/Accepted candidates: 20/30 → 80 with a required reason. The
   * pre-fetch captures each row's varying `from_status` for the audit; the
   * `status IN (revocable)` predicate on the UPDATE is the race guard.
   */
  async revoke(
    driveId: number,
    employeeId: number,
    studentIds: number[],
    reason: string,
    notify: boolean,
  ): Promise<DriveRevokeSummary> {
    const drive = await this.assertDrive(driveId);
    const wanted = [...new Set(studentIds)];

    const targets = await this.repo.find({
      where: {
        drive_id: driveId,
        student_id: In(wanted),
        status: In([...REVOCABLE_STATUSES]),
      },
      select: { id: true, student_id: true, status: true },
    });
    if (targets.length === 0) {
      return { revoked: 0, skipped: wanted.length, requested: wanted.length };
    }

    const result = await this.repo
      .createQueryBuilder()
      .update(DriveStudent)
      .set({
        status: DRIVE_STUDENT_STATUS.REVOKED,
        revoked_at: () => 'now()',
        revoked_by_employee_id: employeeId,
        rejection_reason: reason,
      })
      .where('id IN (:...ids)', { ids: targets.map((t) => t.id) })
      .andWhere('status IN (:...from)', { from: [...REVOCABLE_STATUSES] })
      .returning(['id', 'student_id'])
      .execute();

    const revokedRows = result.raw as { id: number; student_id: number }[];
    const fromById = new Map(targets.map((t) => [t.id, t.status]));
    await this.logEvents(
      revokedRows.map((r) => ({
        drive_student_id: r.id,
        from_status: fromById.get(r.id) ?? null,
        to_status: DRIVE_STUDENT_STATUS.REVOKED,
      })),
      'revoked',
      'employee',
      { actorEmployeeId: employeeId, reason },
    );
    // Mirror the transition into the student approvals inbox (→ cancelled).
    await this.approvalsSync.syncDrivePlacements(
      revokedRows.map((r) => ({
        student_id: r.student_id,
        drive_student_id: r.id,
        drive_status: DRIVE_STUDENT_STATUS.REVOKED,
        reason,
      })),
    );

    const revokedIds = revokedRows.map((r) => r.student_id);
    if (notify && revokedIds.length > 0) {
      void this.notifications
        .send(revokedIds, {
          module: 'placements',
          type: 'drive-revoked',
          title: 'Placement drive update',
          body: `There's an update on ${drive.drive_name} in Placements.`,
          target: { type: 'drive-revoked', id: driveId },
        })
        .catch(() => undefined);
    }

    return {
      revoked: revokedIds.length,
      skipped: wanted.length - revokedIds.length,
      requested: wanted.length,
    };
  }

  /**
   * The full audit trail for one drive-student. Uses the real event log; for
   * rows that predate the audit feature (no events) it synthesises the track
   * from the denormalised timestamp columns so the timeline is never empty.
   */
  async getTrack(driveId: number, studentId: number): Promise<DriveStudentTrack> {
    await this.assertDrive(driveId);
    const row = await this.repo
      .createQueryBuilder('ds')
      .innerJoin('students', 's', 's.id = ds.student_id')
      .where('ds.drive_id = :driveId', { driveId })
      .andWhere('ds.student_id = :studentId', { studentId })
      .select('ds.id', 'id')
      .addSelect('ds.student_id', 'student_id')
      .addSelect('ds.status', 'status')
      .addSelect('s.student_id', 'roll_no')
      .addSelect('s.display_name', 'display_name')
      .addSelect('ds.imported_at', 'imported_at')
      .addSelect('ds.imported_by_employee_id', 'imported_by_employee_id')
      .addSelect('ds.invited_at', 'invited_at')
      .addSelect('ds.invited_by_employee_id', 'invited_by_employee_id')
      .addSelect('ds.responded_at', 'responded_at')
      .addSelect('ds.rejection_reason', 'rejection_reason')
      .addSelect('ds.outcome_marked_at', 'outcome_marked_at')
      .addSelect('ds.outcome_marked_by_employee_id', 'outcome_marked_by_employee_id')
      .addSelect('ds.revoked_at', 'revoked_at')
      .addSelect('ds.revoked_by_employee_id', 'revoked_by_employee_id')
      .getRawOne<{
        id: number;
        student_id: number;
        status: number;
        roll_no: string;
        display_name: string;
        imported_at: Date | null;
        imported_by_employee_id: number | null;
        invited_at: Date | null;
        invited_by_employee_id: number | null;
        responded_at: Date | null;
        rejection_reason: string | null;
        outcome_marked_at: Date | null;
        outcome_marked_by_employee_id: number | null;
        revoked_at: Date | null;
        revoked_by_employee_id: number | null;
      }>();
    if (!row) throw new NotFoundException('Student not found in this drive.');

    const student = {
      id: Number(row.student_id),
      roll_no: row.roll_no,
      display_name: row.display_name,
    };
    const base = {
      student,
      current_status: Number(row.status),
    };

    const events = await this.eventsRepo
      .createQueryBuilder('ev')
      .leftJoin('employees', 'e', 'e.id = ev.actor_employee_id')
      .where('ev.drive_student_id = :id', { id: row.id })
      .orderBy('ev.created_at', 'ASC')
      .addOrderBy('ev.id', 'ASC')
      .select('ev.id', 'id')
      .addSelect('ev.action', 'action')
      .addSelect('ev.from_status', 'from_status')
      .addSelect('ev.to_status', 'to_status')
      .addSelect('ev.reason', 'reason')
      .addSelect('ev.actor_type', 'actor_type')
      .addSelect('ev.actor_employee_id', 'actor_employee_id')
      .addSelect('e.emp_display_name', 'actor_employee_name')
      .addSelect('ev.created_at', 'created_at')
      .getRawMany<{
        id: number;
        action: string;
        from_status: number | null;
        to_status: number;
        reason: string | null;
        actor_type: string;
        actor_employee_id: number | null;
        actor_employee_name: string | null;
        created_at: Date;
      }>();

    if (events.length > 0) {
      return {
        ...base,
        events: events.map((ev) => ({
          id: Number(ev.id),
          action: ev.action,
          from_status: ev.from_status === null ? null : Number(ev.from_status),
          to_status: Number(ev.to_status),
          reason: ev.reason,
          actor_type: ev.actor_type,
          actor_name:
            ev.actor_type === 'student'
              ? student.display_name
              : ev.actor_employee_name,
          created_at: ev.created_at,
        })),
      };
    }

    // No events → synthesise from the denormalised columns (pre-feature row).
    return { ...base, events: await this.synthesiseTrack(row, student) };
  }

  /** Best-effort track reconstruction from the row's timestamp columns. */
  private async synthesiseTrack(
    row: {
      status: number;
      imported_at: Date | null;
      imported_by_employee_id: number | null;
      invited_at: Date | null;
      invited_by_employee_id: number | null;
      responded_at: Date | null;
      rejection_reason: string | null;
      outcome_marked_at: Date | null;
      outcome_marked_by_employee_id: number | null;
      revoked_at: Date | null;
      revoked_by_employee_id: number | null;
    },
    student: { display_name: string },
  ): Promise<DriveStudentTrackEvent[]> {
    // Resolve the employee actor names referenced by the columns in one query.
    const empIds = [
      row.imported_by_employee_id,
      row.invited_by_employee_id,
      row.outcome_marked_by_employee_id,
      row.revoked_by_employee_id,
    ].filter((v): v is number => v != null);
    const names = new Map<number, string>();
    if (empIds.length > 0) {
      const emps = await this.eventsRepo.manager
        .createQueryBuilder()
        .from('employees', 'e')
        .where('e.id IN (:...ids)', { ids: [...new Set(empIds)] })
        .select('e.id', 'id')
        .addSelect('e.emp_display_name', 'name')
        .getRawMany<{ id: number; name: string }>();
      for (const e of emps) names.set(Number(e.id), e.name);
    }
    const empName = (id: number | null) => (id != null ? names.get(id) ?? null : null);

    const out: DriveStudentTrackEvent[] = [];
    let seq = -1;
    const push = (
      at: Date | null,
      action: string,
      from: number | null,
      to: number,
      actor_type: 'employee' | 'student',
      actor_name: string | null,
      reason: string | null = null,
    ) => {
      if (!at) return;
      out.push({
        id: seq--,
        action,
        from_status: from,
        to_status: to,
        reason,
        actor_type,
        actor_name,
        created_at: at,
      });
    };

    push(row.imported_at, 'imported', null, 10, 'employee', empName(row.imported_by_employee_id));
    push(row.invited_at, 'invited', 10, 20, 'employee', empName(row.invited_by_employee_id));
    if (row.responded_at) {
      const denied = row.status === DRIVE_STUDENT_STATUS.DENIED;
      // responded_at is shared by accept/deny; if the row later moved on
      // (outcome/revoke) it was accepted first.
      const accepted = !denied;
      if (accepted) {
        push(row.responded_at, 'accepted', 20, 30, 'student', student.display_name);
      } else {
        push(row.responded_at, 'denied', 20, 40, 'student', student.display_name, row.rejection_reason);
      }
    }
    push(row.outcome_marked_at, 'outcome', 30, row.status, 'employee', empName(row.outcome_marked_by_employee_id));
    push(row.revoked_at, 'revoked', null, 80, 'employee', empName(row.revoked_by_employee_id), row.rejection_reason);

    return out;
  }

  /**
   * Hard-delete a student from the drive — allowed ONLY on Imported rows (never
   * contacted). Once the lifecycle has started (≥ Invited) the row can leave
   * only via {@link revoke}, so its audit trail is never silently destroyed.
   */
  async remove(driveId: number, studentId: number): Promise<void> {
    await this.assertDrive(driveId);
    await this.repo.delete({
      drive_id: driveId,
      student_id: studentId,
      status: DRIVE_STUDENT_STATUS.IMPORTED,
    });
  }

  private async assertDrive(driveId: number): Promise<Drive> {
    const drive = await this.driveRepo.findOne({ where: { id: driveId } });
    if (!drive) throw new NotFoundException('Drive not found.');
    return drive;
  }
}
