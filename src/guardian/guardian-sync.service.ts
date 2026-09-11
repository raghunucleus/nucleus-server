import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Student } from '../admin/entities/student.entity';
import { StudentGuardian } from './entities/student-guardian.entity';
import { GuardianAuthService } from './guardian-auth.service';

/**
 * The two FIXED portal-contact rows mirrored from the flat parent/guardian
 * columns on `students`.
 */
export const SYNCED_GUARDIAN_RELATIONSHIPS = [
  'parent',
  'default_guardian',
] as const;
export type SyncedGuardianRelationship =
  (typeof SYNCED_GUARDIAN_RELATIONSHIPS)[number];

/**
 * Mirrors the flat parent/guardian profile columns into `student_guardians` so
 * the parent portal (login keyed by mobile) always reflects the approved
 * profile data.
 *
 * Model: every student has at most TWO synced rows — (student_id, 'parent')
 * and (student_id, 'default_guardian') — targeted deterministically via the
 * existing (student_id, relationship) unique key. Updates land on those rows
 * only; admin/bulk-managed father/mother/guardian/other contacts are never
 * touched, and synced rows are never deleted. Flat columns are the profile
 * source of truth; the synced rows mirror them.
 *
 * Call `syncFromFlatFields` INSIDE the transaction that wrote the flat
 * columns, then `revokeStaleMobiles` with its return value AFTER commit —
 * revocation clears Redis sessions, which must not happen for a transaction
 * that ends up rolling back.
 */
@Injectable()
export class GuardianSyncService {
  private readonly logger = new Logger(GuardianSyncService.name);

  constructor(private readonly guardianAuth: GuardianAuthService) {}

  private fieldsFor(
    s: Student,
    rel: SyncedGuardianRelationship,
  ): { name: string | null; mobile: string | null; email: string | null } {
    return rel === 'parent'
      ? { name: s.parent_name, mobile: s.parent_mobile, email: s.parent_email }
      : {
          name: s.guardian_name,
          mobile: s.guardian_mobile,
          email: s.guardian_email,
        };
  }

  /**
   * Upsert the synced rows for `studentId` from the student's CURRENT flat
   * columns (read inside `tx`, so call after the columns are written).
   * Returns mobiles that are no longer referenced by ANY student_guardians row
   * — pass them to `revokeStaleMobiles` after the transaction commits.
   */
  async syncFromFlatFields(
    tx: EntityManager,
    studentId: number,
    which: readonly SyncedGuardianRelationship[] = SYNCED_GUARDIAN_RELATIONSHIPS,
  ): Promise<string[]> {
    const student = await tx.getRepository(Student).findOne({
      where: { id: studentId },
    });
    if (!student) return [];

    const repo = tx.getRepository(StudentGuardian);
    const maybeStale: string[] = [];

    for (const rel of which) {
      const { name, mobile, email } = this.fieldsFor(student, rel);
      const row = await repo.findOne({
        where: { student_id: studentId, relationship: rel },
      });

      if (!row) {
        // Create only once both identity pieces exist — a mobile-less contact
        // can't log in and a name-less one can't be addressed. Email may lag
        // (nullable in the table), but without it the OTP email channel can't
        // deliver, so the portal bootstrap waits for it.
        if (!name || !mobile) continue;
        await repo.save(
          repo.create({
            student_id: studentId,
            relationship: rel,
            name,
            mobile_number: mobile,
            email,
            is_primary: false,
          }),
        );
        continue;
      }

      const oldMobile = row.mobile_number;
      if (name) row.name = name;
      if (mobile) row.mobile_number = mobile;
      row.email = email ?? row.email;
      await repo.save(row);
      if (mobile && mobile !== oldMobile) maybeStale.push(oldMobile);
    }

    // A replaced mobile only loses portal access if nothing references it any
    // more (the same number may be a contact on siblings' rows).
    const stale: string[] = [];
    for (const mobile of new Set(maybeStale)) {
      const stillUsed = await repo.count({ where: { mobile_number: mobile } });
      if (stillUsed === 0) stale.push(mobile);
    }
    return stale;
  }

  /**
   * Revoke portal sessions of mobiles freed by a sync. Best-effort, AFTER
   * commit only (mirrors GuardiansService.remove).
   */
  async revokeStaleMobiles(mobiles: string[]): Promise<void> {
    for (const mobile of mobiles) {
      try {
        await this.guardianAuth.revokeAllForMobile(mobile, 'access_removed');
      } catch (err) {
        this.logger.warn(
          `Failed to revoke guardian sessions for ${mobile}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }
  }
}
