import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository, SelectQueryBuilder } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { StudentNotificationService } from '../../student/notification/student-notification.service';
import type {
  SendStudentNotificationEmail,
  StudentNotificationChannels,
} from '../../student/notification/student-notification.types';
import { StudentApprovalsSyncService } from '../../student/approvals/student-approvals-sync.service';
import { StudentSearchDto } from '../../student-query/dto/student-search.dto';
import {
  exportFilename,
  rowsToCsv,
  rowsToXlsx,
} from '../../student-query/export';
import { Surface } from '../../student-query/registry/types';
import { StudentQueryService } from '../../student-query/student-query.service';
import { ExportJobsService } from '../exports/export-jobs.service';
import {
  DEFAULT_DRIVE_EXPORT_COLUMNS,
  DRIVE_EXPORT_COLUMNS,
  DRIVE_EXPORT_COLUMN_BY_KEY,
  DRIVE_EXPORT_GROUP,
  DRIVE_EXPORT_KEY_PREFIX,
  driveColumnMeta,
} from './drive-students-export-columns';
import {
  DriveStudentProfile,
  DriveStudentProfileService,
} from './drive-student-profile.service';
import {
  DRIVE_STUDENT_STATUS,
  DriveStudentAction,
  DriveStudentOutcome,
  REVOCABLE_STATUSES,
} from './drive-student-status';
import { Drive } from './entities/drive.entity';
import { DriveOfferType } from './entities/drive-lookups.entity';
import { DriveProfile } from './entities/drive-profile.entity';
import { DriveStudent } from './entities/drive-student.entity';
import { DriveStudentEvent } from './entities/drive-student-event.entity';
import { MAX_IMPORT_STUDENT_IDS } from './dto/import-drive-students.dto';
import { SelectionPackageInput } from './dto/selection-package.schema';

/** Campus-local time zone — the only one every recipient reads dates in. */
const DISPLAY_TZ = 'Asia/Kolkata';

/** A `date` column (no time) as `21 Jul 2026`. */
function formatDay(value: string): string {
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A timestamptz as `21 Jul 2026, 05:00 pm` in campus time. */
function formatMoment(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: DISPLAY_TZ,
  });
}

/** The ceiling on "import all matched" — a drive shortlist is realistically
 *  hundreds; over this the user is asked to narrow the filter instead. */
const MAX_IMPORT_ALL = MAX_IMPORT_STUDENT_IDS;

/** Hard cap on the `all=1` (load-all, used by the grouped view) list mode.
 *  `total` stays exact, so clients can tell the result was truncated. */
const DRIVE_STUDENTS_ALL_CAP = 2000;

/** Ceiling on a shortlist export. Far above any real drive — this exists to
 *  stop a runaway job, not to shape normal use. */
const MAX_EXPORT_ROWS = 50_000;

/** One pickable export column, as the picker renders it. */
export interface DriveStudentsExportColumn {
  key: string;
  label: string;
  group: string;
  kind: string;
}

export interface DriveStudentsExportColumns {
  groups: ReadonlyArray<{ key: string; label: string }>;
  columns: DriveStudentsExportColumn[];
  defaultColumns: string[];
}

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
  programme_id: number | null;
  pass_out_year: number | null;
  entry_type: number;
  imported_at: Date;
  imported_by: string | null;
  status: number;
  invited_at: Date | null;
  responded_at: Date | null;
  rejection_reason: string | null;
  outcome_marked_at: Date | null;
  // Selection details — set only on Selected (60) rows marked after the
  // designation/amount capture shipped; NULL on legacy selections.
  selected_drive_profile_id: number | null;
  selected_designation: string | null;
  ctc: string | null;
  ctc_min: string | null;
  stipend: string | null;
  stipend_min: string | null;
}

export interface DriveStudentsPage {
  rows: DriveStudentRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/** Raw roster projection — `DriveStudentRow` before numeric coercion. */
type DriveRosterRaw = Omit<
  DriveStudentRow,
  'id' | 'programme_id' | 'pass_out_year' | 'entry_type' | 'status'
> & {
  id: number;
  programme_id: number | null;
  pass_out_year: number | null;
  entry_type: number;
  status: number;
};

/**
 * The Students tab's filter state. The list and the export take the SAME
 * options object, which is what guarantees a download matches the screen.
 */
export interface DriveStudentsListOpts {
  search?: string;
  status?: number;
  programmeIds?: number[];
  passoutYears?: number[];
  entryType?: number;
  /** Load-all mode (grouped view): ignore paging, capped at
   *  {@link DRIVE_STUDENTS_ALL_CAP} rows. List-only — the export has its own
   *  ceiling. */
  all?: boolean;
  studentScope?: DriveStudentScope;
}

/** Distinct filterable values actually present among a drive's students. */
export interface DriveStudentFilterOptions {
  programmes: { id: number; name: string }[];
  passout_years: number[];
  entry_types: number[];
}

/**
 * The caller's accessible programmes/passout years — the placement-coordinator
 * surface passes its RBAC scope; the manage screen passes nothing. `'all'` on
 * an axis drops that filter; callers must short-circuit `[]` (no access)
 * before calling.
 */
export interface DriveStudentScope {
  programmeIds: number[] | 'all';
  passoutYears: number[] | 'all';
}

/** One row of a student's lifecycle in ANOTHER drive (the Drive Activity tab). */
export interface DriveStudentActivityRow {
  drive_id: number;
  drive_name: string;
  drive_status: string;
  drive_date: string | null;
  company: { name: string; logo_url: string | null };
  offer_type: string | null;
  /** The student's status in that drive (drive-student-status.ts codes). */
  status: number;
  imported_at: Date;
  invited_at: Date | null;
  responded_at: Date | null;
  outcome_marked_at: Date | null;
  revoked_at: Date | null;
  rejection_reason: string | null;
  selected_designation: string | null;
  ctc: string | null;
  ctc_min: string | null;
  stipend: string | null;
  stipend_min: string | null;
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
    @InjectRepository(DriveProfile)
    private readonly profilesRepo: Repository<DriveProfile>,
    @InjectRepository(DriveOfferType)
    private readonly offerTypesRepo: Repository<DriveOfferType>,
    private readonly engine: StudentQueryService,
    private readonly notifications: StudentNotificationService,
    private readonly approvalsSync: StudentApprovalsSyncService,
    private readonly profiles: DriveStudentProfileService,
    private readonly storage: StorageService,
    private readonly jobs: ExportJobsService,
  ) {}

  /** Restrict a `students s`-joined query to the caller's RBAC scope. */
  private applyStudentScope(
    qb: SelectQueryBuilder<DriveStudent>,
    scope: DriveStudentScope,
  ): void {
    if (scope.programmeIds !== 'all') {
      qb.andWhere('s.programme_id IN (:...scopeProgIds)', {
        scopeProgIds: scope.programmeIds,
      });
    }
    if (scope.passoutYears !== 'all') {
      qb.andWhere('s.pass_out_year IN (:...scopeYears)', {
        scopeYears: scope.passoutYears,
      });
    }
  }

  /**
   * 404 unless the student is a member of the drive AND (when a scope is
   * given) within the caller's accessible programmes/passout years — a scope
   * miss is indistinguishable from non-membership, so out-of-scope ids don't
   * leak. The access gate for the per-student detail reads below.
   */
  private async assertMember(
    driveId: number,
    studentId: number,
    studentScope?: DriveStudentScope,
  ): Promise<void> {
    const qb = this.repo
      .createQueryBuilder('ds')
      .innerJoin('students', 's', 's.id = ds.student_id')
      .where('ds.drive_id = :driveId', { driveId })
      .andWhere('ds.student_id = :studentId', { studentId });
    if (studentScope) this.applyStudentScope(qb, studentScope);
    if (!(await qb.getExists())) {
      throw new NotFoundException('Student not found in this drive.');
    }
  }

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
    this.assertNotArchived(await this.assertDrive(driveId));

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
    this.assertNotArchived(await this.assertDrive(driveId));

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
    channels?: StudentNotificationChannels,
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
        selected_drive_profile_id: null,
        ctc: null,
        ctc_min: null,
        stipend: null,
        stipend_min: null,
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
      const email = await this.inviteEmail(drive, channels, false);
      void this.notifications
        .send(
          invitedIds,
          {
            module: 'placements',
            type: 'drive-invite',
            title: 'Placement drive invitation',
            body: `You are invited to ${drive.drive_name}. Accept or deny it in Placements.`,
            target: { type: 'drive-invite', id: driveId },
            email,
          },
          { channels },
        )
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
    channels?: StudentNotificationChannels,
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
      channels,
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
    channels?: StudentNotificationChannels,
  ): Promise<DriveRemindSummary> {
    const drive = await this.assertDrive(driveId);
    this.assertNotArchived(drive);
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
    const email = await this.inviteEmail(drive, channels, true);
    void this.notifications
      .send(
        targets.map((t) => t.student_id),
        {
          module: 'placements',
          type: 'drive-invite',
          title: 'Reminder: placement drive invitation',
          body: `Reminder — you're invited to ${drive.drive_name}. Accept or deny it in Placements.`,
          target: { type: 'drive-invite', id: driveId },
          email,
        },
        { channels },
      )
      .catch(() => undefined);

    return {
      reminded: targets.length,
      skipped: wanted.length - targets.length,
      requested: wanted.length,
    };
  }

  /**
   * Validate a selection package against the drive: the profile must belong to
   * it, and the effective offer type's flags decide which amounts are required
   * and which are forbidden — the same bidirectional rule the drive form
   * enforces (`DrivesService.assertPackageMatchesOfferType`). Returns a human
   * summary for the audit trail's `reason`.
   */
  private async assertSelection(
    drive: Drive,
    sel: SelectionPackageInput,
  ): Promise<{ summary: string }> {
    const profile = await this.profilesRepo.findOne({
      where: { id: sel.drive_profile_id, drive_id: drive.id },
      relations: { designation: true },
    });
    if (!profile) {
      throw new BadRequestException(
        'That designation does not belong to this drive.',
      );
    }

    const offerTypeId =
      drive.offer_type_scope === 'designation'
        ? profile.offer_type_id
        : drive.offer_type_id;
    if (offerTypeId == null) {
      // Publishing validates the offer type is set wherever it's in scope, so
      // this only guards drives that predate that rule.
      throw new BadRequestException(
        'This drive has no offer type, so a package cannot be recorded.',
      );
    }
    const offer = await this.offerTypesRepo.findOne({
      where: { id: offerTypeId },
    });
    if (!offer) throw new BadRequestException('Unknown offer type.');

    if (sel.stipend != null && !offer.is_internship) {
      throw new BadRequestException(
        `"${offer.name}" isn't an internship, so the selection can't carry a stipend.`,
      );
    }
    if (sel.ctc != null && !offer.is_full_time) {
      throw new BadRequestException(
        `"${offer.name}" isn't a full-time role, so the selection can't carry a CTC.`,
      );
    }
    if (offer.is_internship && sel.stipend == null) {
      throw new BadRequestException(
        `"${offer.name}" is an internship, so the selection needs a stipend.`,
      );
    }
    if (offer.is_full_time && sel.ctc == null) {
      throw new BadRequestException(
        `"${offer.name}" is a full-time role, so the selection needs a CTC.`,
      );
    }

    const fmt = (v: number) => Number(v).toLocaleString('en-IN');
    const band = (main: number, min: number | null | undefined) =>
      min != null ? `${fmt(min)} – ${fmt(main)}` : fmt(main);
    const parts = [`Selected for ${profile.designation.name}`];
    if (sel.ctc != null) parts.push(`CTC ${band(sel.ctc, sel.ctc_min)} LPA`);
    if (sel.stipend != null) {
      parts.push(`Stipend ₹${band(sel.stipend, sel.stipend_min)}/month`);
    }
    return { summary: parts.join(' · ') };
  }

  /** The five selection columns as UPDATE values — nulls unless Selected. */
  private selectionColumns(sel: SelectionPackageInput | undefined) {
    return {
      selected_drive_profile_id: sel ? sel.drive_profile_id : null,
      ctc: sel?.ctc != null ? String(sel.ctc) : null,
      ctc_min: sel?.ctc_min != null ? String(sel.ctc_min) : null,
      stipend: sel?.stipend != null ? String(sel.stipend) : null,
      stipend_min: sel?.stipend_min != null ? String(sel.stipend_min) : null,
    };
  }

  /**
   * Record the drive-day outcome for ACCEPTED students: 30 → 50/60/70. Only
   * Selected notifies — a rejection shouldn't be broken via a push title; the
   * others surface in-app. A Selected outcome also records the selection
   * details (designation + package), one set applied to the whole batch.
   */
  async markOutcome(
    driveId: number,
    employeeId: number,
    studentIds: number[],
    status: DriveStudentOutcome,
    selection?: SelectionPackageInput,
  ): Promise<DriveOutcomeSummary> {
    const drive = await this.assertDrive(driveId);
    this.assertNotArchived(drive);

    // The DTO guarantees selection is present iff status is 60.
    const summary =
      status === DRIVE_STUDENT_STATUS.SELECTED && selection
        ? (await this.assertSelection(drive, selection)).summary
        : null;

    const wanted = [...new Set(studentIds)];
    const result = await this.repo
      .createQueryBuilder()
      .update(DriveStudent)
      .set({
        status,
        outcome_marked_at: () => 'now()',
        outcome_marked_by_employee_id: employeeId,
        ...this.selectionColumns(
          status === DRIVE_STUDENT_STATUS.SELECTED ? selection : undefined,
        ),
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
      { actorEmployeeId: employeeId, reason: summary },
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

  /**
   * Edit the selection details on a Selected (60) row — full replacement of
   * designation + package, re-validated against the drive's offer-type rules.
   * The status guard doubles as the "only Selected rows" check.
   */
  async updateSelection(
    driveId: number,
    employeeId: number,
    studentId: number,
    sel: SelectionPackageInput,
  ): Promise<{ updated: number }> {
    const drive = await this.assertDrive(driveId);
    this.assertNotArchived(drive);
    const { summary } = await this.assertSelection(drive, sel);

    const result = await this.repo
      .createQueryBuilder()
      .update(DriveStudent)
      .set(this.selectionColumns(sel))
      .where('drive_id = :driveId', { driveId })
      .andWhere('student_id = :studentId', { studentId })
      .andWhere('status = :status', { status: DRIVE_STUDENT_STATUS.SELECTED })
      .returning(['id'])
      .execute();

    const rows = result.raw as { id: number }[];
    if (rows.length === 0) {
      throw new BadRequestException(
        'Selection details can only be edited on a Selected student.',
      );
    }
    await this.logEvents(
      [
        {
          drive_student_id: rows[0].id,
          from_status: DRIVE_STUDENT_STATUS.SELECTED,
          to_status: DRIVE_STUDENT_STATUS.SELECTED,
        },
      ],
      'selection_updated',
      'employee',
      { actorEmployeeId: employeeId, reason: summary },
    );
    return { updated: rows.length };
  }

  /**
   * The Students tab's filtered row set — shared verbatim by {@link list} and
   * {@link export_}, so an export can never disagree with what's on screen.
   *
   * `studentScope`, when given, restricts rows (and the count) to students
   * within the caller's accessible programmes/passout years — the
   * placement-coordinator surface passes its RBAC scope here; the manage
   * screen passes nothing. `'all'` on an axis drops that filter; callers must
   * short-circuit `[]` (no access) before calling.
   */
  private buildListQuery(
    driveId: number,
    opts: DriveStudentsListOpts,
  ): SelectQueryBuilder<DriveStudent> {
    const qb = this.repo
      .createQueryBuilder('ds')
      .innerJoin('students', 's', 's.id = ds.student_id')
      .leftJoin('programmes', 'p', 'p.id = s.programme_id')
      .leftJoin('employees', 'e', 'e.id = ds.imported_by_employee_id')
      .leftJoin(
        'drive_profiles',
        'sdp',
        'sdp.id = ds.selected_drive_profile_id',
      )
      .leftJoin('drive_designations', 'sdd', 'sdd.id = sdp.designation_id')
      .where('ds.drive_id = :driveId', { driveId });

    if (opts.studentScope) this.applyStudentScope(qb, opts.studentScope);

    const search = opts.search?.trim();
    if (search) {
      qb.andWhere('(s.display_name ILIKE :q OR s.student_id ILIKE :q)', {
        q: `%${search}%`,
      });
    }
    if (opts.status !== undefined) {
      qb.andWhere('ds.status = :status', { status: opts.status });
    }
    if (opts.programmeIds?.length) {
      qb.andWhere('s.programme_id IN (:...fProgIds)', {
        fProgIds: opts.programmeIds,
      });
    }
    if (opts.passoutYears?.length) {
      qb.andWhere('s.pass_out_year IN (:...fYears)', {
        fYears: opts.passoutYears,
      });
    }
    if (opts.entryType !== undefined) {
      qb.andWhere('s.entry_type = :fEntryType', { fEntryType: opts.entryType });
    }
    return qb;
  }

  /** The roster projection + its stable ordering, shared by list and export. */
  private applyRosterSelect(
    qb: SelectQueryBuilder<DriveStudent>,
  ): SelectQueryBuilder<DriveStudent> {
    return qb
      .select('ds.student_id', 'id')
      .addSelect('s.student_id', 'roll_no')
      .addSelect('s.display_name', 'display_name')
      .addSelect('p.display_name', 'programme')
      .addSelect('s.programme_id', 'programme_id')
      .addSelect('s.pass_out_year', 'pass_out_year')
      .addSelect('s.entry_type', 'entry_type')
      .addSelect('ds.imported_at', 'imported_at')
      .addSelect('e.emp_display_name', 'imported_by')
      .addSelect('ds.status', 'status')
      .addSelect('ds.invited_at', 'invited_at')
      .addSelect('ds.responded_at', 'responded_at')
      .addSelect('ds.rejection_reason', 'rejection_reason')
      .addSelect('ds.outcome_marked_at', 'outcome_marked_at')
      .addSelect('ds.selected_drive_profile_id', 'selected_drive_profile_id')
      .addSelect('sdd.name', 'selected_designation')
      .addSelect('ds.ctc', 'ctc')
      .addSelect('ds.ctc_min', 'ctc_min')
      .addSelect('ds.stipend', 'stipend')
      .addSelect('ds.stipend_min', 'stipend_min')
      .orderBy('ds.imported_at', 'DESC')
      .addOrderBy('ds.student_id', 'DESC');
  }

  /** The drive's shortlist for the Students tab. */
  async list(
    driveId: number,
    opts: DriveStudentsListOpts & { page: number; pageSize: number },
  ): Promise<DriveStudentsPage> {
    await this.assertDrive(driveId);
    const page = Math.max(1, opts.page);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize));

    const qb = this.buildListQuery(driveId, opts);

    const total = await qb.getCount();

    const raw = await this.applyRosterSelect(qb)
      .offset(opts.all ? 0 : (page - 1) * pageSize)
      .limit(opts.all ? DRIVE_STUDENTS_ALL_CAP : pageSize)
      .getRawMany<DriveRosterRaw>();

    return {
      rows: raw.map((r) => ({
        id: Number(r.id),
        roll_no: r.roll_no,
        display_name: r.display_name,
        programme: r.programme,
        programme_id: r.programme_id == null ? null : Number(r.programme_id),
        pass_out_year: r.pass_out_year == null ? null : Number(r.pass_out_year),
        entry_type: Number(r.entry_type),
        imported_at: r.imported_at,
        imported_by: r.imported_by,
        status: Number(r.status),
        invited_at: r.invited_at,
        responded_at: r.responded_at,
        rejection_reason: r.rejection_reason,
        outcome_marked_at: r.outcome_marked_at,
        selected_drive_profile_id:
          r.selected_drive_profile_id == null
            ? null
            : Number(r.selected_drive_profile_id),
        selected_designation: r.selected_designation,
        ctc: r.ctc,
        ctc_min: r.ctc_min,
        stipend: r.stipend,
        stipend_min: r.stipend_min,
      })),
      total,
      page: opts.all ? 1 : page,
      pageSize: opts.all ? DRIVE_STUDENTS_ALL_CAP : pageSize,
      pageCount: opts.all ? 1 : Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------

  /**
   * The pickable export columns: the drive's own lifecycle fields plus every
   * selectable student attribute, in one payload so the picker is one fetch.
   *
   * `student_id` and `display_name` need no special casing — they are implicit
   * RESULT columns but also ordinary registry attributes, so the selectable
   * filter already yields them. (Only `id` is implicit without being an
   * attribute, and it is not worth exporting.)
   */
  exportColumns(surface: Surface): DriveStudentsExportColumns {
    const meta = this.engine.meta(surface);
    return {
      groups: [DRIVE_EXPORT_GROUP, ...meta.groups],
      columns: [
        ...DRIVE_EXPORT_COLUMNS.map((c) => ({
          key: c.key,
          label: c.label,
          group: DRIVE_EXPORT_GROUP.key,
          kind: c.kind,
        })),
        ...meta.attributes
          .filter((a) => a.selectable)
          .map((a) => ({
            key: a.key,
            label: a.label,
            group: a.group,
            kind: a.kind,
          })),
      ],
      defaultColumns: [...DEFAULT_DRIVE_EXPORT_COLUMNS],
    };
  }

  /**
   * Queue a spreadsheet of the drive's shortlist, exactly as filtered on the
   * Students tab, with caller-chosen columns in caller-chosen order.
   *
   * Two engines feed one sheet: `drive.*` columns come from the roster query
   * (which already carries them), student columns from
   * {@link StudentQueryService.hydrateIds}. Row order is the roster's, so the
   * file matches the screen top to bottom.
   */
  async export_(
    employeeId: number,
    driveId: number,
    opts: DriveStudentsListOpts,
    dto: { columns?: string[]; format: 'csv' | 'xlsx' },
    surface: Surface = 'employee',
  ): Promise<{ job_id: number }> {
    const drive = await this.assertDrive(driveId);
    const { format } = dto;

    const columns = dto.columns?.length
      ? [...new Set(dto.columns)]
      : [...DEFAULT_DRIVE_EXPORT_COLUMNS];

    // Split on the namespace, PRESERVING the caller's order in `columns` —
    // that array alone decides the sheet's layout; these two are just routing.
    const driveKeys = columns.filter((k) =>
      k.startsWith(DRIVE_EXPORT_KEY_PREFIX),
    );
    const studentKeys = columns.filter(
      (k) => !k.startsWith(DRIVE_EXPORT_KEY_PREFIX),
    );
    const unknown = driveKeys.filter((k) => !DRIVE_EXPORT_COLUMN_BY_KEY.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown export column(s): ${unknown.join(', ')}.`,
      );
    }

    // Bound the result set synchronously — a request too large to export must
    // fail the HTTP call, not a background job the user waits on.
    const total = await this.buildListQuery(driveId, opts).getCount();
    if (total > MAX_EXPORT_ROWS) {
      throw new BadRequestException(
        `Too many students to export (${total} rows, max ${MAX_EXPORT_ROWS.toLocaleString('en-US')}). Narrow the filters.`,
      );
    }

    // The closure snapshots everything — a drive edited or deleted mid-job
    // doesn't change the file.
    const snapshot = { driveId, opts, columns, driveKeys, studentKeys };
    return this.jobs
      .create({
        employeeId,
        source: 'drive_students_tab',
        label: `Shortlist — ${drive.drive_name}`,
        context: { drive_id: driveId },
        format,
        filename: exportFilename(format),
        generate: () => this.buildExportFile(snapshot, format, surface),
      })
      .then(({ id }) => ({ job_id: id }));
  }

  private async buildExportFile(
    snap: {
      driveId: number;
      opts: DriveStudentsListOpts;
      columns: string[];
      driveKeys: string[];
      studentKeys: string[];
    },
    format: 'csv' | 'xlsx',
    surface: Surface,
  ): Promise<{ buffer: Buffer; rowCount: number }> {
    const roster = await this.applyRosterSelect(
      this.buildListQuery(snap.driveId, snap.opts),
    )
      .limit(MAX_EXPORT_ROWS)
      .getRawMany<DriveRosterRaw>();

    const studentIds = roster.map((r) => Number(r.id));
    const hydrated = await this.engine.hydrateIds(
      studentIds,
      snap.studentKeys,
      surface,
    );
    const studentRowById = new Map(hydrated.rows.map((r) => [Number(r.id), r]));

    const rows = roster.map((r) => {
      const out: Record<string, unknown> = {
        ...(studentRowById.get(Number(r.id)) ?? {}),
      };
      for (const key of snap.driveKeys) {
        out[key] = (r as Record<string, unknown>)[
          DRIVE_EXPORT_COLUMN_BY_KEY.get(key)!.raw
        ];
      }
      return out;
    });

    const meta = driveColumnMeta();
    // Short click-through label — the URL itself never appears in the cell.
    meta.set('resume_external_url', {
      label: 'Resume',
      kind: 'link',
      linkText: 'Resume',
    });

    const buffer =
      format === 'csv'
        ? rowsToCsv(snap.columns, rows, meta)
        : await rowsToXlsx(snap.columns, rows, meta);
    return { buffer, rowCount: rows.length };
  }

  /**
   * The distinct programme / passout-year / entry-type values present among
   * the drive's students — the source for the Students tab filter dropdowns.
   * `studentScope`, when given, narrows the option pool exactly like
   * {@link list}, so out-of-scope values are never offered.
   */
  async filterOptions(
    driveId: number,
    studentScope?: DriveStudentScope,
  ): Promise<DriveStudentFilterOptions> {
    await this.assertDrive(driveId);

    const base = () => {
      const qb = this.repo
        .createQueryBuilder('ds')
        .innerJoin('students', 's', 's.id = ds.student_id')
        .where('ds.drive_id = :driveId', { driveId });
      if (studentScope) this.applyStudentScope(qb, studentScope);
      return qb;
    };

    const [progRaw, yearRaw, entryRaw] = await Promise.all([
      base()
        .leftJoin('programmes', 'p', 'p.id = s.programme_id')
        .andWhere('s.programme_id IS NOT NULL')
        .select('s.programme_id', 'id')
        .addSelect('p.display_name', 'name')
        .distinct(true)
        .orderBy('p.display_name', 'ASC')
        .getRawMany<{ id: number; name: string | null }>(),
      base()
        .andWhere('s.pass_out_year IS NOT NULL')
        .select('s.pass_out_year', 'year')
        .distinct(true)
        .orderBy('s.pass_out_year', 'DESC')
        .getRawMany<{ year: number }>(),
      base()
        .select('s.entry_type', 'entry_type')
        .distinct(true)
        .orderBy('s.entry_type', 'ASC')
        .getRawMany<{ entry_type: number }>(),
    ]);

    return {
      programmes: progRaw.map((r) => ({
        id: Number(r.id),
        name: r.name ?? `Programme #${r.id}`,
      })),
      passout_years: yearRaw.map((r) => Number(r.year)),
      entry_types: entryRaw.map((r) => Number(r.entry_type)),
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
    this.assertNotArchived(drive);
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
  async getTrack(
    driveId: number,
    studentId: number,
    opts: { studentScope?: DriveStudentScope } = {},
  ): Promise<DriveStudentTrack> {
    await this.assertDrive(driveId);
    const qb = this.repo
      .createQueryBuilder('ds')
      .innerJoin('students', 's', 's.id = ds.student_id')
      .where('ds.drive_id = :driveId', { driveId })
      .andWhere('ds.student_id = :studentId', { studentId });
    if (opts.studentScope) this.applyStudentScope(qb, opts.studentScope);
    const row = await qb
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
      .addSelect(
        'ds.outcome_marked_by_employee_id',
        'outcome_marked_by_employee_id',
      )
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

  /**
   * The full profile behind a Students-tab row. Membership in THIS drive (plus
   * the caller's scope, when given) is the access gate — the profile itself is
   * unscoped once the student is legitimately visible.
   */
  async getStudentProfile(
    driveId: number,
    studentId: number,
    opts: { studentScope?: DriveStudentScope } = {},
  ): Promise<DriveStudentProfile> {
    await this.assertDrive(driveId);
    await this.assertMember(driveId, studentId, opts.studentScope);
    return this.profiles.getProfile(studentId);
  }

  /**
   * The student's lifecycle in every OTHER drive, latest activity first.
   * Includes Imported (10) rows — employees see the whole shortlist history,
   * unlike the student-facing `myDrives` which hides never-invited rows.
   */
  async driveActivity(
    driveId: number,
    studentId: number,
    opts: { studentScope?: DriveStudentScope } = {},
  ): Promise<{ items: DriveStudentActivityRow[] }> {
    await this.assertDrive(driveId);
    await this.assertMember(driveId, studentId, opts.studentScope);

    const rows = await this.repo.find({
      where: { student_id: studentId, drive_id: Not(driveId) },
      relations: {
        drive: { company: true, offer_type: true },
        selected_drive_profile: { designation: true },
      },
    });

    const items = await Promise.all(
      rows.map(async (r): Promise<DriveStudentActivityRow> => {
        const d = r.drive;
        return {
          drive_id: d.id,
          drive_name: d.drive_name,
          drive_status: d.status,
          drive_date: d.drive_date,
          company: {
            name: d.company.name,
            logo_url: d.company.logo_key
              ? await this.storage
                  .getCachedReadUrl(d.company.logo_key)
                  .catch(() => null)
              : null,
          },
          offer_type: d.offer_type?.name ?? null,
          status: r.status,
          imported_at: r.imported_at,
          invited_at: r.invited_at,
          responded_at: r.responded_at,
          outcome_marked_at: r.outcome_marked_at,
          revoked_at: r.revoked_at,
          rejection_reason: r.rejection_reason,
          selected_designation:
            r.selected_drive_profile?.designation?.name ?? null,
          ctc: r.ctc,
          ctc_min: r.ctc_min,
          stipend: r.stipend,
          stipend_min: r.stipend_min,
        };
      }),
    );

    // Most recent thing that happened to the row, whatever stage it is in.
    const lastActivity = (r: DriveStudentActivityRow): number =>
      Math.max(
        ...[
          r.outcome_marked_at,
          r.revoked_at,
          r.responded_at,
          r.invited_at,
          r.imported_at,
        ]
          .filter((t): t is Date => t != null)
          .map((t) => t.getTime()),
      );
    items.sort((a, b) => lastActivity(b) - lastActivity(a));

    return { items };
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
    const empName = (id: number | null) =>
      id != null ? (names.get(id) ?? null) : null;

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

    push(
      row.imported_at,
      'imported',
      null,
      10,
      'employee',
      empName(row.imported_by_employee_id),
    );
    push(
      row.invited_at,
      'invited',
      10,
      20,
      'employee',
      empName(row.invited_by_employee_id),
    );
    if (row.responded_at) {
      const denied = row.status === DRIVE_STUDENT_STATUS.DENIED;
      // responded_at is shared by accept/deny; if the row later moved on
      // (outcome/revoke) it was accepted first.
      const accepted = !denied;
      if (accepted) {
        push(
          row.responded_at,
          'accepted',
          20,
          30,
          'student',
          student.display_name,
        );
      } else {
        push(
          row.responded_at,
          'denied',
          20,
          40,
          'student',
          student.display_name,
          row.rejection_reason,
        );
      }
    }
    push(
      row.outcome_marked_at,
      'outcome',
      30,
      row.status,
      'employee',
      empName(row.outcome_marked_by_employee_id),
    );
    push(
      row.revoked_at,
      'revoked',
      null,
      80,
      'employee',
      empName(row.revoked_by_employee_id),
      row.rejection_reason,
    );

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

  /**
   * The email presentation for an invite or reminder: company, drive, date and
   * the response deadline as a details table, plus a CTA that deep-links to this
   * drive in the student app.
   *
   * Returns `undefined` when the email channel is off, so the company lookup
   * (the only extra query the mail needs) is skipped for the common in-app-only
   * send. `assertDrive` deliberately stays relation-free for the same reason —
   * it runs on every student action.
   */
  private async inviteEmail(
    drive: Drive,
    channels: StudentNotificationChannels | undefined,
    isReminder: boolean,
  ): Promise<SendStudentNotificationEmail | undefined> {
    if (!channels?.email) return undefined;

    const company = await this.driveRepo
      .findOne({
        where: { id: drive.id },
        relations: { company: true },
        select: { id: true, company: { id: true, name: true } },
      })
      .then((d) => d?.company?.name ?? null)
      .catch(() => null);

    const details: { label: string; value: string }[] = [];
    if (company) details.push({ label: 'Company', value: company });
    details.push({ label: 'Drive', value: drive.drive_name });
    if (drive.drive_date) {
      details.push({ label: 'Drive date', value: formatDay(drive.drive_date) });
    }
    if (drive.registration_end_date) {
      details.push({
        label: 'Respond before',
        value: formatMoment(drive.registration_end_date),
      });
    }

    return {
      subject: isReminder
        ? `Reminder: placement drive invitation — ${company ?? drive.drive_name}`
        : `Placement drive invitation — ${company ?? drive.drive_name}`,
      intro: isReminder
        ? 'You have not yet responded to this placement drive invitation. Accept or deny it before the registration window closes.'
        : 'You have been invited to a placement drive. Review the details below and accept or deny the invitation before the registration window closes.',
      details,
      url: this.driveUrl(drive.id),
      ctaLabel: 'View drive & respond',
    };
  }

  /**
   * Absolute student-app link to this drive's invitation. Built with `URL` so a
   * STUDENT_APP_URL carrying a baked-in query string (the shared dev port does)
   * survives, and mirrors the client's own target registry, which resolves a
   * `drive-invite` target to `/placements?tab=invites&drive=<id>`.
   */
  private driveUrl(driveId: number): string {
    const base = process.env.STUDENT_APP_URL || 'http://localhost:5000';
    const url = new URL(base);
    url.pathname = '/placements';
    url.searchParams.set('tab', 'invites');
    url.searchParams.set('drive', String(driveId));
    return url.toString();
  }

  private async assertDrive(driveId: number): Promise<Drive> {
    const drive = await this.driveRepo.findOne({ where: { id: driveId } });
    if (!drive) throw new NotFoundException('Drive not found.');
    return drive;
  }

  /**
   * An archived drive is closed: no imports, invites, reminders, outcomes,
   * selection edits or revokes. Terminal student states are left frozen.
   */
  private assertNotArchived(drive: Drive): void {
    if (drive.status === 'archived') {
      throw new BadRequestException(
        'This drive is archived; no further student actions are allowed.',
      );
    }
  }
}
