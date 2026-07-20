import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { DRIVE_STUDENT_STATUS } from '../../employee/drive-management/drive-student-status';
import { DrivesService } from '../../employee/drive-management/drives.service';
import { Drive } from '../../employee/drive-management/entities/drive.entity';
import { DriveStudent } from '../../employee/drive-management/entities/drive-student.entity';
import { DriveStudentEvent } from '../../employee/drive-management/entities/drive-student-event.entity';
import { StorageService } from '../../storage/storage.service';
import { StudentApprovalsSyncService } from '../approvals/student-approvals-sync.service';

/** The card shape both student lists share. */
interface PlacementDriveCard {
  drive_id: number;
  drive_name: string;
  company: { name: string; logo_url: string | null };
  offer_type: string | null;
  job_locations: string[];
  registration_end_date: string | null;
  drive_date: string | null;
}

export interface PlacementInviteRow extends PlacementDriveCard {
  invited_at: Date | null;
}

export interface PlacementDeniedRow extends PlacementInviteRow {
  responded_at: Date | null;
  rejection_reason: string | null;
}

/**
 * What the student was actually selected for — present iff status is SELECTED.
 * Amounts are per-student figures recorded by the placement cell, NOT the
 * advertised drive bands: ctc is in LPA, stipend in ₹/month, and the main
 * column holds the fixed value or the range MAX (`_min` null ⇒ fixed amount).
 * Rows selected before this data was captured have every field null.
 */
export interface PlacementSelection {
  drive_profile_id: number | null;
  designation: string | null;
  ctc: string | null;
  ctc_min: string | null;
  stipend: string | null;
  stipend_min: string | null;
}

export interface PlacementDriveRecordRow extends PlacementDriveCard {
  status: number;
  invited_at: Date | null;
  responded_at: Date | null;
  outcome_marked_at: Date | null;
  revoked_at: Date | null;
  /** Denial (student) or revoke (employee) reason, when the row is terminal. */
  rejection_reason: string | null;
  /** Only meaningful when status is REVOKED: true = revoked after accepting. */
  revoked_from_accepted: boolean | null;
  selection: PlacementSelection | null;
}

/**
 * One entry of the student's own action trail on a drive. Actor identity is
 * collapsed to "you" vs "placement_cell" — employee identities are never
 * exposed to students.
 */
export interface PlacementHistoryEvent {
  action:
    | 'invited'
    | 'reminded'
    | 'accepted'
    | 'denied'
    | 'outcome'
    | 'revoked'
    | 'selection_updated';
  to_status: number;
  by: 'you' | 'placement_cell';
  reason: string | null;
  at: Date;
}

/**
 * The student's own placement journey — invites to answer and the drives they
 * accepted. Every method is keyed on the studentId taken from the JWT; there is
 * deliberately no way to pass any other id (see the student-API isolation
 * contract in CLAUDE.md).
 *
 * Accept/deny use status-guarded UPDATEs (`WHERE status = 20`), which is both
 * the transition validation and the race guard against a concurrent employee
 * action on the same row.
 */
@Injectable()
export class StudentPlacementsService {
  constructor(
    @InjectRepository(DriveStudent)
    private readonly members: Repository<DriveStudent>,
    @InjectRepository(DriveStudentEvent)
    private readonly events: Repository<DriveStudentEvent>,
    @InjectRepository(Drive)
    private readonly driveRepo: Repository<Drive>,
    private readonly drives: DrivesService,
    private readonly storage: StorageService,
    private readonly approvalsSync: StudentApprovalsSyncService,
  ) {}

  /** Pending invitations (20) plus the student's denied history (40). */
  async invites(studentId: number): Promise<{
    pending: PlacementInviteRow[];
    denied: PlacementDeniedRow[];
  }> {
    const rows = await this.loadRows(studentId, [
      DRIVE_STUDENT_STATUS.INVITED,
      DRIVE_STUDENT_STATUS.DENIED,
    ]);

    const pending: PlacementInviteRow[] = [];
    const denied: PlacementDeniedRow[] = [];
    for (const r of rows) {
      const card = await this.card(r);
      if (r.status === DRIVE_STUDENT_STATUS.INVITED) {
        pending.push({ ...card, invited_at: r.invited_at });
      } else {
        denied.push({
          ...card,
          invited_at: r.invited_at,
          responded_at: r.responded_at,
          rejection_reason: r.rejection_reason,
        });
      }
    }
    pending.sort(byDateDesc((r) => r.invited_at));
    denied.sort(byDateDesc((r) => r.responded_at));
    return { pending, denied };
  }

  /**
   * Every drive the student was ever invited to (status >= 20) with its current
   * state — the full placement history. Clients filter this list themselves
   * (upcoming / selected / rejected / …); imported-but-not-invited rows stay
   * invisible.
   */
  async myDrives(studentId: number): Promise<{
    items: PlacementDriveRecordRow[];
  }> {
    const rows = await this.loadRows(studentId, [
      DRIVE_STUDENT_STATUS.INVITED,
      DRIVE_STUDENT_STATUS.ACCEPTED,
      DRIVE_STUDENT_STATUS.DENIED,
      DRIVE_STUDENT_STATUS.NOT_ATTENDED,
      DRIVE_STUDENT_STATUS.SELECTED,
      DRIVE_STUDENT_STATUS.NOT_SELECTED,
      DRIVE_STUDENT_STATUS.REVOKED,
    ]);
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...(await this.card(r)),
        status: r.status,
        invited_at: r.invited_at,
        responded_at: r.responded_at,
        outcome_marked_at: r.outcome_marked_at,
        revoked_at: r.revoked_at,
        rejection_reason: r.rejection_reason,
        // Denied rows are never revocable, so on a revoked row a non-null
        // responded_at can only mean the student had accepted first.
        revoked_from_accepted:
          r.status === DRIVE_STUDENT_STATUS.REVOKED
            ? r.responded_at != null
            : null,
        selection: selectionOf(r),
      })),
    );
    items.sort(byDateDesc(lastActivity));
    return { items };
  }

  /**
   * The full drive detail (JD, designations, package, attachments) for a drive
   * this student was invited to. Imported-but-not-invited students must NOT see
   * the drive — 404, indistinguishable from a drive that doesn't exist.
   */
  async driveDetail(studentId: number, driveId: number) {
    const membership = await this.members.findOne({
      where: { student_id: studentId, drive_id: driveId },
      relations: { selected_drive_profile: { designation: true } },
    });
    if (!membership || membership.status < DRIVE_STUDENT_STATUS.INVITED) {
      throw new NotFoundException('Drive not found.');
    }

    // Reuse the employee assembly, minus the SPOC contact details — students
    // route questions through the placement cell, not the company contact.
    const {
      spoc_email: _e,
      spoc_contact: _c,
      ...drive
    } = await this.drives.get(driveId);

    // Who the drive is open to — ids already resolved to labels server-side, so
    // the student never touches the employee-only eligibility-options endpoint.
    const eligibility = await this.drives.eligibilitySummary(driveId);

    // The student's own action trail. Import happens before the student is
    // allowed to know the drive exists, so that event stays hidden.
    const events = await this.events.find({
      where: { drive_student_id: membership.id, action: Not('imported') },
      order: { created_at: 'ASC', id: 'ASC' },
    });
    const history: PlacementHistoryEvent[] = events.map((e) => ({
      action: e.action as PlacementHistoryEvent['action'],
      to_status: e.to_status,
      by: e.actor_type === 'student' ? 'you' : 'placement_cell',
      reason: e.reason,
      at: e.created_at,
    }));

    return {
      drive,
      eligibility,
      membership: {
        status: membership.status,
        invited_at: membership.invited_at,
        responded_at: membership.responded_at,
        rejection_reason: membership.rejection_reason,
        outcome_marked_at: membership.outcome_marked_at,
        selection: selectionOf(membership),
      },
      history,
    };
  }

  /** Accept a pending invite: 20 → 30 — but only before the deadline passes. */
  async accept(
    studentId: number,
    driveId: number,
  ): Promise<{ status: number }> {
    const drive = await this.driveRepo.findOne({
      where: { id: driveId },
      select: { id: true, registration_end_date: true },
    });
    if (
      drive?.registration_end_date &&
      new Date(drive.registration_end_date).getTime() < Date.now()
    ) {
      throw new BadRequestException(
        'This invitation has expired — the registration window has closed.',
      );
    }
    await this.respond(studentId, driveId, DRIVE_STUDENT_STATUS.ACCEPTED, {
      responded_at: () => 'now()',
    });
    return { status: DRIVE_STUDENT_STATUS.ACCEPTED };
  }

  /** Deny a pending invite: 20 → 40, reason required. */
  async reject(
    studentId: number,
    driveId: number,
    reason: string,
  ): Promise<{ status: number }> {
    await this.respond(studentId, driveId, DRIVE_STUDENT_STATUS.DENIED, {
      responded_at: () => 'now()',
      rejection_reason: reason,
    });
    return { status: DRIVE_STUDENT_STATUS.DENIED };
  }

  /**
   * Status-guarded response update (20 → toStatus); 0 rows affected = invite no
   * longer open. Records the student's action in the audit trail.
   */
  private async respond(
    studentId: number,
    driveId: number,
    toStatus: number,
    set: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.members
      .createQueryBuilder()
      .update(DriveStudent)
      .set({ ...set, status: toStatus })
      .where('student_id = :studentId', { studentId })
      .andWhere('drive_id = :driveId', { driveId })
      .andWhere('status = :from', { from: DRIVE_STUDENT_STATUS.INVITED })
      .returning(['id'])
      .execute();
    const row = (result.raw as { id: number }[])[0];
    if (!result.affected || !row) {
      throw new BadRequestException('This invitation is no longer open.');
    }
    await this.events.insert({
      drive_student_id: row.id,
      action:
        toStatus === DRIVE_STUDENT_STATUS.ACCEPTED ? 'accepted' : 'denied',
      from_status: DRIVE_STUDENT_STATUS.INVITED,
      to_status: toStatus,
      actor_type: 'student',
      actor_employee_id: null,
      reason: (set.rejection_reason as string | undefined) ?? null,
    });
    // Mirror the decision into the student approvals inbox (→ approved/rejected).
    await this.approvalsSync.syncDrivePlacements([
      {
        student_id: studentId,
        drive_student_id: row.id,
        drive_status: toStatus,
        reason: (set.rejection_reason as string | undefined) ?? null,
      },
    ]);
  }

  private loadRows(
    studentId: number,
    statuses: number[],
  ): Promise<DriveStudent[]> {
    return this.members.find({
      where: { student_id: studentId, status: In(statuses) },
      relations: {
        drive: { company: true, offer_type: true, job_locations: true },
        selected_drive_profile: { designation: true },
      },
    });
  }

  private async card(r: DriveStudent): Promise<{
    drive_id: number;
    drive_name: string;
    company: { name: string; logo_url: string | null };
    offer_type: string | null;
    job_locations: string[];
    registration_end_date: string | null;
    drive_date: string | null;
  }> {
    const d = r.drive;
    return {
      drive_id: d.id,
      drive_name: d.drive_name,
      company: {
        name: d.company.name,
        logo_url: d.company.logo_key
          ? await this.storage.getCachedReadUrl(d.company.logo_key)
          : null,
      },
      offer_type: d.offer_type?.name ?? null,
      job_locations: (d.job_locations ?? []).map((l) => l.name),
      registration_end_date: d.registration_end_date,
      drive_date: d.drive_date,
    };
  }
}

/**
 * Selection details, only ever revealed on a SELECTED row. The designation may
 * be null even on a fresh selection (profile deleted after the fact — the FK
 * is SET NULL while the package columns survive).
 */
function selectionOf(r: DriveStudent): PlacementSelection | null {
  if (r.status !== DRIVE_STUDENT_STATUS.SELECTED) return null;
  return {
    drive_profile_id: r.selected_drive_profile_id,
    designation: r.selected_drive_profile?.designation?.name ?? null,
    ctc: r.ctc,
    ctc_min: r.ctc_min,
    stipend: r.stipend,
    stipend_min: r.stipend_min,
  };
}

function byDateDesc<T>(pick: (row: T) => Date | null) {
  return (a: T, b: T) => (pick(b)?.getTime() ?? 0) - (pick(a)?.getTime() ?? 0);
}

/** Most recent thing that happened to the row, whatever stage it is in. */
function lastActivity(r: PlacementDriveRecordRow): Date | null {
  const times = [
    r.outcome_marked_at,
    r.revoked_at,
    r.responded_at,
    r.invited_at,
  ].filter((d): d is Date => d != null);
  if (!times.length) return null;
  return times.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
}
