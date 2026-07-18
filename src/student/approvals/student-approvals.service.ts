import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { DRIVE_STUDENT_STATUS } from '../../employee/drive-management/drive-student-status';
import { DriveStudent } from '../../employee/drive-management/entities/drive-student.entity';
import { StorageService } from '../../storage/storage.service';
import {
  StudentApproval,
  StudentApprovalStatus,
  STUDENT_APPROVAL_MODULE_PLACEMENTS,
  STUDENT_APPROVAL_STATUSES,
} from './entities/student-approval.entity';

/** The drive card embedded in a placement approval — mirrors the client's
 *  PlacementDriveRecord so the existing invite/record cards render unchanged. */
interface ApprovalDrivePayload {
  drive_id: number;
  drive_name: string;
  company: { name: string; logo_url: string | null };
  offer_type: string | null;
  job_locations: string[];
  registration_end_date: string | null;
  drive_date: string | null;
  /** The drive-native numeric status (drives the granular row badge). */
  status: number;
  invited_at: Date | null;
  responded_at: Date | null;
  outcome_marked_at: Date | null;
  revoked_at: Date | null;
  rejection_reason: string | null;
  revoked_from_accepted: boolean | null;
}

export interface StudentApprovalItem {
  id: number;
  module: string;
  type: string;
  status: StudentApprovalStatus;
  /** When the item entered the inbox — non-null on every row, drives date filter/sort. */
  created_at: Date;
  decided_at: Date | null;
  reason: string | null;
  /** Present for placement approvals; the client keys rendering off `module`. */
  drive: ApprovalDrivePayload | null;
}

export type StudentApprovalCounts = Record<string, number>;

/**
 * Reads the student approvals inbox from `student_approvals` (durable core
 * status + cheap GROUP BY counts) and hydrates each row's display payload from
 * its owning module. Scoped exclusively to the JWT student — the id never comes
 * from the request.
 */
@Injectable()
export class StudentApprovalsService {
  constructor(
    @InjectRepository(StudentApproval)
    private readonly approvals: Repository<StudentApproval>,
    @InjectRepository(DriveStudent)
    private readonly members: Repository<DriveStudent>,
    private readonly storage: StorageService,
  ) {}

  /** The student's approvals, newest activity first, optionally narrowed. */
  async list(
    studentId: number,
    filters: { status?: StudentApprovalStatus; module?: string },
  ): Promise<StudentApprovalItem[]> {
    const rows = await this.approvals.find({
      where: {
        student_id: studentId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.module ? { module: filters.module } : {}),
      },
      order: { updated_at: 'DESC', id: 'DESC' },
    });

    const drives = await this.hydrateDrives(rows);
    return rows.map((r) => ({
      id: r.id,
      module: r.module,
      type: r.type,
      status: r.status as StudentApprovalStatus,
      created_at: r.created_at,
      decided_at: r.decided_at,
      reason: r.reason,
      drive:
        r.module === STUDENT_APPROVAL_MODULE_PLACEMENTS
          ? (drives.get(r.ref_id) ?? null)
          : null,
    }));
  }

  /** Per-status tally across every module — seeds all statuses so chips render. */
  async counts(studentId: number): Promise<StudentApprovalCounts> {
    const rows = await this.approvals
      .createQueryBuilder('a')
      .select('a.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('a.student_id = :me', { me: studentId })
      .groupBy('a.status')
      .getRawMany<{ status: string; count: string }>();
    const counts: StudentApprovalCounts = {};
    for (const s of STUDENT_APPROVAL_STATUSES) counts[s] = 0;
    for (const r of rows) counts[r.status] = Number(r.count);
    return counts;
  }

  /** Load + card-ify the drive_students rows behind placement approvals. */
  private async hydrateDrives(
    rows: StudentApproval[],
  ): Promise<Map<number, ApprovalDrivePayload>> {
    const refIds = rows
      .filter((r) => r.module === STUDENT_APPROVAL_MODULE_PLACEMENTS)
      .map((r) => r.ref_id);
    const out = new Map<number, ApprovalDrivePayload>();
    if (refIds.length === 0) return out;

    const members = await this.members.find({
      where: { id: In(refIds) },
      relations: {
        drive: { company: true, offer_type: true, job_locations: true },
      },
    });
    for (const m of members) {
      const d = m.drive;
      out.set(m.id, {
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
        status: m.status,
        invited_at: m.invited_at,
        responded_at: m.responded_at,
        outcome_marked_at: m.outcome_marked_at,
        revoked_at: m.revoked_at,
        rejection_reason: m.rejection_reason,
        // Denied rows are never revocable, so a revoked row with a non-null
        // responded_at can only mean the student had accepted first.
        revoked_from_accepted:
          m.status === DRIVE_STUDENT_STATUS.REVOKED
            ? m.responded_at != null
            : null,
      });
    }
    return out;
  }
}
