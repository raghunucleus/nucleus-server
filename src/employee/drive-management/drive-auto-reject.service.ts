import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { StudentNotificationService } from '../../student/notification/student-notification.service';
import { StudentApprovalsSyncService } from '../../student/approvals/student-approvals-sync.service';
import { DRIVE_STUDENT_STATUS } from './drive-student-status';
import { Drive } from './entities/drive.entity';
import { DriveStudentEvent } from './entities/drive-student-event.entity';

const AUTO_REJECT_REASON =
  'No action taken, auto rejected after the registration end date';

/** One row off the sweep's `UPDATE ... RETURNING`. */
type SweptRow = { id: number; student_id: number; drive_id: number };

/**
 * Closes the loop on the registration deadline. Hourly, any invite still
 * pending (status 20) whose drive's `registration_end_date` has passed is
 * auto-denied (20 → 40) with a fixed reason, an audit event, and a heads-up to
 * the student. Accepting is already blocked at the deadline in
 * `StudentPlacementsService.accept`; this sweep just settles the stored status.
 */
@Injectable()
export class DriveAutoRejectService {
  private readonly logger = new Logger('DriveAutoReject');

  constructor(
    @InjectRepository(Drive)
    private readonly drives: Repository<Drive>,
    private readonly dataSource: DataSource,
    private readonly notifications: StudentNotificationService,
    private readonly approvalsSync: StudentApprovalsSyncService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    // The status change, its audit event and the approvals mirror go in one
    // transaction — a failure downstream must not leave students denied with no
    // paper trail and no notification.
    const swept = await this.dataSource.transaction(async (manager) => {
      // Race-safe transition — the `status = 20` guard mirrors the accept path,
      // so a student accepting in the same instant can't be double-handled.
      //
      // `query()` on an UPDATE resolves to `[rows, rowCount]`, NOT the rows —
      // the Postgres driver special-cases UPDATE/DELETE. Destructure, never
      // annotate the call as a row array.
      const [rows] = (await manager.query(
        `UPDATE "drive_students" ds
            SET status = $1, responded_at = now(), rejection_reason = $2
           FROM "drives" d
          WHERE ds.drive_id = d.id
            AND ds.status = $3
            AND d.registration_end_date IS NOT NULL
            AND d.registration_end_date < now()
        RETURNING ds.id, ds.student_id, ds.drive_id`,
        [
          DRIVE_STUDENT_STATUS.DENIED,
          AUTO_REJECT_REASON,
          DRIVE_STUDENT_STATUS.INVITED,
        ],
      )) as [SweptRow[], number];
      if (rows.length === 0) return rows;

      await manager.getRepository(DriveStudentEvent).insert(
        rows.map((r) => ({
          drive_student_id: r.id,
          action: 'denied',
          from_status: DRIVE_STUDENT_STATUS.INVITED,
          to_status: DRIVE_STUDENT_STATUS.DENIED,
          actor_type: 'system' as const,
          actor_employee_id: null,
          reason: AUTO_REJECT_REASON,
        })),
      );

      // Mirror the auto-denial into the student approvals inbox (→ rejected).
      await this.approvalsSync.syncDrivePlacements(
        rows.map((r) => ({
          student_id: r.student_id,
          drive_student_id: r.id,
          drive_status: DRIVE_STUDENT_STATUS.DENIED,
          reason: AUTO_REJECT_REASON,
        })),
        manager,
      );

      return rows;
    });
    if (swept.length === 0) return;

    // Past the commit — notifications must never fire for a rolled-back sweep.
    // Notify per drive so the drive name is fetched once and recipients fan out.
    const byDrive = new Map<number, number[]>();
    for (const r of swept) {
      const list = byDrive.get(r.drive_id) ?? [];
      list.push(r.student_id);
      byDrive.set(r.drive_id, list);
    }
    const driveRows = await this.drives.find({
      where: { id: In([...byDrive.keys()]) },
      select: { id: true, drive_name: true },
    });
    const nameById = new Map(driveRows.map((d) => [d.id, d.drive_name]));
    for (const [driveId, studentIds] of byDrive) {
      const name = nameById.get(driveId) ?? 'a placement drive';
      void this.notifications
        .send(studentIds, {
          module: 'placements',
          type: 'drive-auto-reject',
          title: 'Placement invitation expired',
          body: `The registration window for ${name} has closed, so your pending invitation was withdrawn.`,
          target: { type: 'drive-invite', id: driveId },
        })
        .catch(() => undefined);
    }

    this.logger.log(`Auto-rejected ${swept.length} expired invitation(s).`);
  }
}
