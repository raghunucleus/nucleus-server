import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProgrammeAdmissionYearProfileVerifier } from '../../admin/entities/programme-admission-year-profile-verifier.entity';
import { Student } from '../../admin/entities/student.entity';
import { displayedAdmissionYear } from '../../common/admission-year';
import { StudentNotificationService } from '../../student/notification/student-notification.service';
import { PROFILE_FIELD_LABELS } from '../../student/profile/profile-fields';
import {
  completionPct,
  computeCompleteness,
} from '../../student/profile/profile-completeness';
import { DriveStudentProfileService } from './drive-student-profile.service';

export const COORDINATOR_STUDENTS_SCREEN_KEY =
  'placement_coordinator.students.view';

export interface CoordinatorBatch {
  programme_admission_year_id: number;
  programme_id: number;
  programme_name: string;
  admission_year_id: number;
  admission_year: number;
  admission_year_display: string;
  label: string;
}

/**
 * The Placement Coordinator's cohort surface — placement readiness for the
 * students of the batches this employee verifies profiles for.
 *
 * Row scope does NOT come from RBAC attributes. The catalog grants the screen
 * (view / edit), but *which* students it shows is decided entirely by
 * `programme_admission_year_profile_verifiers`, the same table the approval
 * requests framework joins for its row scope. So:
 *
 *  - the batch selector lists exactly the employee's verifier rows;
 *  - no verifier rows = an empty selector and no students, never "all";
 *  - a `programme_admission_year_id` outside that set 404s (never 403), so an
 *    out-of-scope batch is indistinguishable from a nonexistent one.
 *
 * `assertBatch` is the single choke point — every read and the one write call
 * it first, so there is no path to a student outside the verified batches.
 */
@Injectable()
export class PlacementCoordinatorStudentsService {
  constructor(
    @InjectRepository(ProgrammeAdmissionYearProfileVerifier)
    private readonly verifiers: Repository<ProgrammeAdmissionYearProfileVerifier>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly profiles: DriveStudentProfileService,
    private readonly notifications: StudentNotificationService,
  ) {}

  /** The (programme × admission year) batches this employee verifies. */
  async myBatches(employeeId: number): Promise<CoordinatorBatch[]> {
    const rows = await this.verifiers.find({
      where: { employee_id: employeeId },
      relations: { programme_admission_year: true },
    });

    return rows
      .map((v) => {
        const pay = v.programme_admission_year;
        const programmeName =
          pay.programme?.display_name || pay.programme?.name || '—';
        // Batches are keyed by admission year; entry_type is per-student, so
        // the batch label uses the plain (regular) display year.
        const yearDisplay = displayedAdmissionYear(
          pay.admission_year.display_year,
          1,
        );
        return {
          programme_admission_year_id: pay.id,
          programme_id: pay.programme_id,
          programme_name: programmeName,
          admission_year_id: pay.admission_year_id,
          admission_year: pay.admission_year.year,
          admission_year_display: yearDisplay,
          label: `${programmeName} / ${yearDisplay}`,
        };
      })
      .sort(
        (a, b) =>
          b.admission_year - a.admission_year ||
          a.programme_name.localeCompare(b.programme_name),
      );
  }

  /**
   * 404 on a batch this employee doesn't verify — scope misses don't leak.
   * Public because the search and analytics services funnel through this same
   * check; it is the one place batch access is decided.
   */
  async assertBatch(
    employeeId: number,
    payId: number,
  ): Promise<CoordinatorBatch> {
    const batch = (await this.myBatches(employeeId)).find(
      (b) => b.programme_admission_year_id === payId,
    );
    if (!batch) throw new NotFoundException('Batch not found.');
    return batch;
  }

  /** The student, verified to belong to the batch — 404 otherwise. */
  private async assertStudent(
    employeeId: number,
    payId: number,
    studentId: number,
  ): Promise<Student> {
    const batch = await this.assertBatch(employeeId, payId);
    const student = await this.students.findOne({
      where: {
        id: studentId,
        programme_id: batch.programme_id,
        admission_year_id: batch.admission_year_id,
      },
    });
    if (!student) throw new NotFoundException('Student not found.');
    return student;
  }

  hasResume(s: Student): boolean {
    return s.resume_external_url !== null;
  }

  /** The placement + completion facts the list row and the toggle need. */
  rowView(s: Student) {
    const completeness = computeCompleteness(s);
    return {
      id: s.id,
      roll_no: s.student_id,
      display_name: s.display_name,
      allowed_by_dept_for_placements: s.allowed_by_dept_for_placements,
      interested_in_placements_self: s.interested_in_placements_self,
      completion: {
        required: completeness.required,
        filled: completeness.filled,
        pct: completionPct(completeness),
      },
    };
  }

  /**
   * The full profile of an in-batch student. Reuses the drive surfaces' reader
   * (same registry groups) and re-attaches the completeness the drive surface
   * deliberately strips — here it's the point of the screen.
   *
   * Government IDs ARE included: the coordinator verifies these students'
   * profiles, so Aadhaar/PAN are part of what they check. The scope is the
   * verifier table, not an RBAC wildcard, so this is narrower than it looks.
   */
  async profile(employeeId: number, payId: number, studentId: number) {
    const s = await this.assertStudent(employeeId, payId, studentId);
    const profile = await this.profiles.getProfile(studentId, {
      includeGovIds: true,
    });
    const completeness = computeCompleteness(s);
    return {
      ...profile,
      completion: {
        required: completeness.required,
        filled: completeness.filled,
        pct: completionPct(completeness),
        missing: completeness.missing,
      },
      placement: {
        allowed_by_dept_for_placements: s.allowed_by_dept_for_placements,
        interested_in_placements_self: s.interested_in_placements_self,
      },
    };
  }

  /**
   * Set the department's placement approval for one in-batch student.
   * Tri-state (null = not decided) to match the admin editor. Never touches
   * `interested_in_placements_self` — that is the student's own declaration.
   */
  async setAllowed(
    employeeId: number,
    payId: number,
    studentId: number,
    allowed: boolean | null,
  ) {
    await this.assertStudent(employeeId, payId, studentId);
    await this.students.update(
      { id: studentId },
      { allowed_by_dept_for_placements: allowed },
    );
    const updated = await this.students.findOneOrFail({
      where: { id: studentId },
    });
    return this.rowView(updated);
  }

  /**
   * Ask an in-batch student to fill specific profile fields, with the
   * coordinator's own message and their choice of channels.
   *
   * Awaited rather than fired detached (the pattern the drive-outcome notice
   * uses): this send IS the coordinator's action, so a failure has to surface
   * as a failed request instead of a silent success toast.
   */
  async notifyProfileUpdate(
    employeeId: number,
    payId: number,
    studentId: number,
    input: {
      field_keys: string[];
      message: string;
      channels: { in_app: boolean; push: boolean; email: boolean };
    },
  ) {
    await this.assertStudent(employeeId, payId, studentId);

    const labels = input.field_keys.map((key) => {
      const label = PROFILE_FIELD_LABELS[key];
      if (!label) throw new BadRequestException(`Unknown field: ${key}`);
      return label;
    });

    const title = 'Action needed: update your profile';
    const body = labels.length
      ? `${input.message}\n\nFields to update: ${labels.join(', ')}`
      : input.message;

    await this.notifications.send(
      studentId,
      {
        module: 'profile',
        type: 'profile-update-request',
        title,
        body,
        target: { type: 'profile' },
      },
      { channels: input.channels },
    );

    return { sent: true, fields: labels };
  }
}
