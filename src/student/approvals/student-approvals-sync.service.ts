import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DRIVE_STUDENT_STATUS } from '../../employee/drive-management/drive-student-status';
import {
  StudentApproval,
  StudentApprovalStatus,
  STUDENT_APPROVAL_MODULE_PLACEMENTS,
  STUDENT_APPROVAL_TYPE_DRIVE_INVITE,
} from './entities/student-approval.entity';

/** One drive-student transition to mirror into the approvals table. */
export interface DrivePlacementSync {
  student_id: number;
  /** `drive_students.id` — the approval row's `ref_id`. */
  drive_student_id: number;
  /** The new numeric drive status (20/30/40/…/80). */
  drive_status: number;
  reason?: string | null;
}

/**
 * Keeps `student_approvals` in step with the modules that own the underlying
 * records. Dependency-free on purpose (only its own repository) so the modules
 * that write transitions can import it without any circular dependency.
 *
 * Upserts are keyed on `(module, ref_id)`, so re-running a sync (e.g. a retried
 * request) is idempotent — it never creates a duplicate row.
 */
@Injectable()
export class StudentApprovalsSyncService {
  constructor(
    @InjectRepository(StudentApproval)
    private readonly repo: Repository<StudentApproval>,
  ) {}

  /** Collapse a drive record's numeric lifecycle onto the common core status. */
  static driveStatusToCore(driveStatus: number): StudentApprovalStatus {
    switch (driveStatus) {
      case DRIVE_STUDENT_STATUS.INVITED:
        return 'pending';
      case DRIVE_STUDENT_STATUS.DENIED:
        return 'rejected';
      case DRIVE_STUDENT_STATUS.REVOKED:
        return 'cancelled';
      default:
        // accepted, selected, not_selected, not_attended
        return 'approved';
    }
  }

  /**
   * Mirror one or more placement drive-student transitions. A `pending` row
   * (a fresh or re-sent invite) clears the decision fields; any other status
   * stamps `decided_at` now and carries the reason.
   */
  async syncDrivePlacements(rows: DrivePlacementSync[]): Promise<void> {
    if (rows.length === 0) return;
    const now = new Date();
    const values = rows.map((r) => {
      const status = StudentApprovalsSyncService.driveStatusToCore(
        r.drive_status,
      );
      const pending = status === 'pending';
      return {
        student_id: r.student_id,
        module: STUDENT_APPROVAL_MODULE_PLACEMENTS,
        type: STUDENT_APPROVAL_TYPE_DRIVE_INVITE,
        ref_id: r.drive_student_id,
        status,
        decided_at: pending ? null : now,
        reason: pending ? null : (r.reason ?? null),
        updated_at: now,
      };
    });
    await this.repo.upsert(values, {
      conflictPaths: ['module', 'ref_id'],
      skipUpdateIfNoValuesChanged: false,
    });
  }
}
