import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AttendanceGroup } from '../../admin/entities/attendance-group.entity';
import { Employee } from '../../admin/entities/employee.entity';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { ProgrammeSemesterSubject } from '../../admin/entities/programme-semester-subject.entity';
import { Timetable } from '../../admin/entities/timetable.entity';
import { TimetableCourse } from '../../admin/entities/timetable-course.entity';
import type { TimetableEntry } from '../../admin/entities/timetable-entry.entity';
import { EmployeesService } from '../../admin/employees/employees.service';
import { ProgrammeSemestersService } from '../../admin/programme-semesters/programme-semesters.service';
import { ProgrammeSemesterSubjectsService } from '../../admin/programme-semester-subjects/programme-semester-subjects.service';
import { RosterService } from '../../admin/sessions/roster.service';
import {
  PreviewResult,
  PublishResult,
  type SeedWindow,
} from '../../admin/sessions/session-seeder.service';
import {
  TimetableSummary,
  TimetablesService,
  WeekSummary,
} from '../../admin/timetables/timetables.service';
import { StudentNotificationService } from '../../student/notification/student-notification.service';

export interface InchargeGroupSummary {
  id: number;
  name: string;
  code: string;
  /** Free-text note set by an admin — disambiguates groups that share a
   *  programme + year (e.g. "Morning lab batch"). */
  description: string | null;
  programme: {
    id: number;
    code: string;
    name: string;
    display_name: string;
    department: { id: number; code: string; name: string } | null;
  };
  admission_year: { id: number; year: number; display_year: string };
  /** Count of active students currently in the group. */
  member_count: number;
}

/**
 * Schedule management for an attendance group incharge. Wraps the admin
 * `TimetablesService` with group-ownership checks: the incharge can only
 * read/edit/publish timetables that belong to one of their owned
 * `attendance_groups`. Once ownership is verified, the heavy lifting is
 * delegated to the admin service so we keep a single canonical
 * implementation of timetable + session-seeding logic.
 *
 * Ownership pivots on `attendance_group_incharges` (one row per group ×
 * in-charge employee). The
 * `listGroups` method is also exposed here so the schedule page can pick
 * groups without having to depend on a separate attendance module.
 */
@Injectable()
export class InchargeScheduleService {
  constructor(
    @InjectRepository(AttendanceGroup)
    private readonly groups: Repository<AttendanceGroup>,
    @InjectRepository(Timetable)
    private readonly timetables: Repository<Timetable>,
    @InjectRepository(TimetableCourse)
    private readonly courses: Repository<TimetableCourse>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    private readonly timetablesService: TimetablesService,
    private readonly programmeSemestersService: ProgrammeSemestersService,
    private readonly pssService: ProgrammeSemesterSubjectsService,
    private readonly employeesService: EmployeesService,
    private readonly roster: RosterService,
    private readonly notifications: StudentNotificationService,
  ) {}

  private readonly logger = new Logger(InchargeScheduleService.name);

  // --- groups --------------------------------------------------------------

  /**
   * Active attendance groups the employee is incharge of. Drives the group
   * picker on the schedule page — and is the source of truth for ownership
   * (every other read/write here calls `ownedGroupIds`, which scans the
   * same table). Includes the programme department, the admin-set
   * description, and an active-student count so the picker can disambiguate
   * groups that share a programme + admission year.
   */
  async listGroups(employeeId: number): Promise<InchargeGroupSummary[]> {
    const rows = await this.groups
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.programme', 'programme')
      .leftJoinAndSelect('programme.department', 'department')
      .leftJoinAndSelect('g.admission_year', 'admission_year')
      .innerJoin('g.incharges', 'gi', 'gi.employee_id = :eid', {
        eid: employeeId,
      })
      .where('g.is_active = TRUE')
      .orderBy('programme.code', 'ASC')
      .addOrderBy('admission_year.year', 'DESC')
      .addOrderBy('g.code', 'ASC')
      .getMany();
    if (rows.length === 0) return [];

    // Bulk count of active members per group — single round-trip rather
    // than N+1.
    const ids = rows.map((r) => r.id);
    const countRows = await this.groups.manager
      .createQueryBuilder()
      .select('sg.attendance_group_id', 'gid')
      .addSelect('COUNT(*)', 'n')
      .from('student_groups', 'sg')
      .innerJoin('students', 's', 's.id = sg.student_id AND s.is_active = TRUE')
      .where('sg.attendance_group_id IN (:...ids)', { ids })
      .groupBy('sg.attendance_group_id')
      .getRawMany<{ gid: string; n: string }>();
    const countMap = new Map(
      countRows.map((r) => [Number(r.gid), Number(r.n)]),
    );

    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      code: g.code,
      description: g.description,
      programme: {
        id: g.programme.id,
        code: g.programme.code,
        name: g.programme.name,
        display_name: g.programme.display_name,
        department: g.programme.department
          ? {
              id: g.programme.department.id,
              code: g.programme.department.code,
              name: g.programme.department.name,
            }
          : null,
      },
      admission_year: {
        id: g.admission_year.id,
        year: g.admission_year.year,
        display_year: g.admission_year.display_year,
      },
      member_count: countMap.get(g.id) ?? 0,
    }));
  }

  // --- listings ------------------------------------------------------------

  /**
   * List timetable summaries for the groups the incharge owns. Filters can
   * narrow to a single (programme_semester, group) pair — but the group must
   * still be one the caller owns.
   */
  async list(
    employeeId: number,
    programmeSemesterId?: number,
    attendanceGroupId?: number,
  ): Promise<TimetableSummary[]> {
    const ownedIds = await this.ownedGroupIds(employeeId);
    if (ownedIds.length === 0) return [];
    if (
      attendanceGroupId !== undefined &&
      !ownedIds.includes(attendanceGroupId)
    ) {
      throw new ForbiddenException(
        "You aren't the incharge of that attendance group.",
      );
    }

    // Pull the admin service's list (no group filter when listing a
    // programme_semester broadly), then restrict to owned groups.
    const all = await this.timetablesService.list(
      programmeSemesterId,
      attendanceGroupId,
    );
    return all.filter((t) => ownedIds.includes(t.attendance_group_id));
  }

  async getOne(employeeId: number, id: number): Promise<Timetable> {
    await this.requireOwnedTimetable(employeeId, id);
    return this.timetablesService.getOne(id);
  }

  async getWeekSummaries(
    employeeId: number,
    id: number,
    weekStarts: string[],
  ): Promise<WeekSummary[]> {
    await this.requireOwnedTimetable(employeeId, id);
    return this.timetablesService.getWeekSummaries(id, weekStarts);
  }

  // --- mutations: timetable lifecycle -------------------------------------

  async create(
    employeeId: number,
    input: {
      programme_semester_id: number;
      attendance_group_id: number;
      name: string;
      working_days: number[];
      periods: {
        label: string;
        start_time: string;
        end_time: string;
        is_break: boolean;
      }[];
    },
  ): Promise<Timetable> {
    const ownedIds = await this.ownedGroupIds(employeeId);
    if (!ownedIds.includes(input.attendance_group_id)) {
      throw new ForbiddenException(
        "You aren't the incharge of that attendance group.",
      );
    }
    return this.timetablesService.create(input);
  }

  async update(
    employeeId: number,
    id: number,
    patch: { name?: string; working_days?: number[] },
  ): Promise<Timetable> {
    await this.requireOwnedTimetable(employeeId, id);
    return this.timetablesService.update(id, patch);
  }

  async remove(employeeId: number, id: number): Promise<void> {
    await this.requireOwnedTimetable(employeeId, id);
    return this.timetablesService.remove(id);
  }

  async clone(
    employeeId: number,
    id: number,
    input: { name: string },
  ): Promise<Timetable> {
    await this.requireOwnedTimetable(employeeId, id);
    return this.timetablesService.clone(id, input);
  }

  async setDefault(employeeId: number, id: number): Promise<Timetable> {
    await this.requireOwnedTimetable(employeeId, id);
    return this.timetablesService.setDefault(id);
  }

  // --- mutations: bell schedule + grid ------------------------------------

  async savePeriods(
    employeeId: number,
    id: number,
    periods: {
      id?: number;
      label: string;
      start_time: string;
      end_time: string;
      is_break: boolean;
    }[],
  ): Promise<Timetable> {
    await this.requireOwnedTimetable(employeeId, id);
    return this.timetablesService.savePeriods(id, periods);
  }

  async upsertEntry(
    employeeId: number,
    timetableId: number,
    input: {
      day_of_week: number;
      timetable_period_id: number;
      span: number;
      programme_semester_subject_id?: number;
      timetable_course_id?: number;
      employee_id: number | null;
      room: string | null;
      note: string | null;
    },
  ): Promise<TimetableEntry> {
    await this.requireOwnedTimetable(employeeId, timetableId);
    return this.timetablesService.upsertEntry(timetableId, input);
  }

  async clearEntry(
    employeeId: number,
    timetableId: number,
    dayOfWeek: number,
    periodId: number,
  ): Promise<void> {
    await this.requireOwnedTimetable(employeeId, timetableId);
    return this.timetablesService.clearEntry(timetableId, dayOfWeek, periodId);
  }

  // --- mutations: courses --------------------------------------------------

  async createCourse(
    employeeId: number,
    timetableId: number,
    input: {
      subject_id?: number;
      custom_label?: string;
      employee_ids: number[];
    },
  ): Promise<Timetable> {
    await this.requireOwnedTimetable(employeeId, timetableId);
    return this.timetablesService.createCourse(timetableId, input);
  }

  async updateCourse(
    employeeId: number,
    courseId: number,
    patch: { subject_id?: number | null; custom_label?: string | null },
  ): Promise<Timetable> {
    await this.requireOwnedCourse(employeeId, courseId);
    return this.timetablesService.updateCourse(courseId, patch);
  }

  async removeCourse(employeeId: number, courseId: number): Promise<Timetable> {
    await this.requireOwnedCourse(employeeId, courseId);
    return this.timetablesService.removeCourse(courseId);
  }

  async setCourseFaculty(
    employeeId: number,
    courseId: number,
    employeeIds: number[],
  ): Promise<Timetable> {
    await this.requireOwnedCourse(employeeId, courseId);
    return this.timetablesService.setCourseFaculty(courseId, employeeIds);
  }

  // --- publishing ----------------------------------------------------------

  async previewWeek(
    employeeId: number,
    id: number,
    week: { from: string; to: string; days_of_week?: number[] },
  ): Promise<PreviewResult> {
    await this.requireOwnedTimetable(employeeId, id);
    return this.timetablesService.previewWeek(id, week);
  }

  async publishWeek(
    employeeId: number,
    id: number,
    week: SeedWindow,
    notify = true,
  ): Promise<PublishResult> {
    const tt = await this.requireOwnedTimetable(employeeId, id);
    const result = await this.timetablesService.publishWeek(id, week);
    // Only notify when publishing actually touched the live schedule. A no-op
    // (e.g. a fully holiday-blocked window that seeds nothing) shouldn't ping
    // students with "your timetable changed".
    const changed = result.inserted > 0 || result.replaced > 0;
    if (notify && changed) {
      // Best-effort: a notification failure must never fail the publish (it's
      // already committed). Students get an in-app + push alert that deep-links
      // to the published week.
      await this.notifyStudentsOfPublish(tt.attendance_group_id, week).catch(
        (err) =>
          this.logger.error(
            `Publish notify failed (group=${tt.attendance_group_id}): ${String(err)}`,
          ),
      );
    }
    return result;
  }

  /** Tell every student in the group their timetable for this week changed,
   *  with a target that deep-links to that week on web + mobile. */
  private async notifyStudentsOfPublish(
    attendanceGroupId: number,
    week: SeedWindow,
  ): Promise<void> {
    const studentIds = await this.roster.studentIdsForGroup(attendanceGroupId);
    if (studentIds.length === 0) return;
    await this.notifications.send(studentIds, {
      module: 'timetable',
      type: 'week-published',
      title: 'Timetable updated',
      body: `Your class timetable for ${formatWeekRange(week.from, week.to)} has been updated. Tap to view your week.`,
      target: {
        type: 'week',
        id: week.from,
        // `week` (the Monday/week-start, YYYY-MM-DD) is what both clients use
        // to open that week directly.
        params: { week: week.from },
      },
    });
  }

  // --- lookups for the schedule editor -------------------------------------

  /**
   * Programme semesters reachable from the incharge's owned groups. Each
   * attendance group is pinned to a (programme_id, admission_year_id) batch;
   * we return every active ProgrammeSemester whose (programme, year) matches
   * a group the caller owns. Optional `attendanceGroupId` narrows to one
   * owned group's batch. Drives the create-timetable picker.
   */
  async listProgrammeSemesters(
    employeeId: number,
    attendanceGroupId?: number,
  ): Promise<ProgrammeSemester[]> {
    const ownedIds = await this.ownedGroupIds(employeeId);
    if (ownedIds.length === 0) return [];
    if (
      attendanceGroupId !== undefined &&
      !ownedIds.includes(attendanceGroupId)
    ) {
      throw new ForbiddenException(
        "You aren't the incharge of that attendance group.",
      );
    }
    const filterIds =
      attendanceGroupId !== undefined ? [attendanceGroupId] : ownedIds;
    const groups = await this.groups.find({ where: { id: In(filterIds) } });
    if (groups.length === 0) return [];

    // Distinct (programme_id, admission_year_id) pairs across the owned groups.
    const pairs = new Map<string, { p: number; y: number }>();
    for (const g of groups) {
      const key = `${g.programme_id}:${g.admission_year_id}`;
      if (!pairs.has(key)) {
        pairs.set(key, { p: g.programme_id, y: g.admission_year_id });
      }
    }

    // Bulk-fetch programme_semesters for those pairs.
    const programmeIds = [...new Set([...pairs.values()].map((p) => p.p))];
    const admissionYearIds = [...new Set([...pairs.values()].map((p) => p.y))];
    const rows = await this.programmeSemesters
      .createQueryBuilder('ps')
      .leftJoinAndSelect('ps.programme', 'programme')
      .leftJoinAndSelect('ps.admission_year', 'admission_year')
      .leftJoinAndSelect('ps.semester', 'semester')
      .where('ps.programme_id IN (:...pids)', { pids: programmeIds })
      .andWhere('ps.admission_year_id IN (:...yids)', {
        yids: admissionYearIds,
      })
      .andWhere('ps.is_active = TRUE')
      .orderBy('admission_year.year', 'DESC')
      .addOrderBy('semester.sem_number', 'ASC')
      .getMany();

    // Filter to the exact (programme, year) pairs in the owned groups — the
    // IN/IN cross-join above may include irrelevant combinations.
    return rows.filter((r) =>
      pairs.has(`${r.programme_id}:${r.admission_year_id}`),
    );
  }

  /**
   * Active programme-semester subjects for a PS, scoped to the given group's
   * faculty allocations. Returns the raw shape from the admin service —
   * including the `faculty` (single allocation for this group) and
   * `alternate_faculty` (allocations from other groups) virtual fields the
   * editor needs to render its subject + teacher picker.
   */
  async listProgrammeSemesterSubjects(
    employeeId: number,
    programmeSemesterId: number,
    attendanceGroupId: number,
  ): Promise<ProgrammeSemesterSubject[]> {
    const ownedIds = await this.ownedGroupIds(employeeId);
    if (!ownedIds.includes(attendanceGroupId)) {
      throw new ForbiddenException(
        "You aren't the incharge of that attendance group.",
      );
    }
    // Verify the PS matches the group's batch — otherwise the subject list
    // would reveal data from semesters the incharge has no claim on.
    const group = await this.groups.findOne({
      where: { id: attendanceGroupId },
    });
    const ps = await this.programmeSemesters.findOne({
      where: { id: programmeSemesterId },
    });
    if (!group || !ps)
      throw new NotFoundException('Group or semester not found');
    if (
      ps.programme_id !== group.programme_id ||
      ps.admission_year_id !== group.admission_year_id
    ) {
      throw new ForbiddenException(
        "That programme semester doesn't match this group's batch.",
      );
    }

    const res = await this.pssService.list({
      page: 1,
      pageSize: 500,
      sortBy: 'created_at',
      sortOrder: 'asc',
      status: 'active',
      programmeSemesterId,
      attendanceGroupId,
    });
    return res.rows;
  }

  /**
   * Active employees, lean fields only — used by the course-faculty picker.
   * No department filter; the admin can already see every employee, and the
   * incharge needs to be able to pull in cross-department guests as faculty
   * for timetable-exclusive subjects.
   */
  async listAllocatableEmployees(): Promise<
    { id: number; emp_code: string; emp_display_name: string }[]
  > {
    const res = await this.employeesService.list({
      page: 1,
      pageSize: 1000,
      sortBy: 'emp_display_name',
      sortOrder: 'asc',
      status: 'active',
    });
    return res.rows.map((e) => ({
      id: e.id,
      emp_code: e.emp_code,
      emp_display_name: e.emp_display_name,
    }));
  }

  // --- internals -----------------------------------------------------------

  /**
   * Public so the sibling InchargeSessionsService can reuse the same source
   * of truth without re-querying attendance_groups in a slightly different
   * way. Returns the set of active group ids the employee is incharge of.
   */
  async ownedGroupIds(employeeId: number): Promise<number[]> {
    const rows = await this.groups
      .createQueryBuilder('g')
      .select('g.id', 'id')
      .innerJoin('g.incharges', 'gi', 'gi.employee_id = :eid', {
        eid: employeeId,
      })
      .where('g.is_active = TRUE')
      .getRawMany<{ id: string }>();
    return rows.map((r) => Number(r.id));
  }

  private async requireOwnedTimetable(
    employeeId: number,
    timetableId: number,
  ): Promise<Timetable> {
    const tt = await this.timetables.findOne({ where: { id: timetableId } });
    if (!tt) throw new NotFoundException('Timetable not found');
    const ownedIds = await this.ownedGroupIds(employeeId);
    if (!ownedIds.includes(tt.attendance_group_id)) {
      throw new ForbiddenException(
        "You aren't the incharge of that timetable's attendance group.",
      );
    }
    return tt;
  }

  private async requireOwnedCourse(
    employeeId: number,
    courseId: number,
  ): Promise<TimetableCourse> {
    const course = await this.courses.findOne({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    await this.requireOwnedTimetable(employeeId, course.timetable_id);
    return course;
  }
}

// Readable week range for a notification body, e.g. "25 May – 31 May 2026".
function formatWeekRange(from: string, to: string): string {
  const dm = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
  });
  const dmy = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (start.getFullYear() !== end.getFullYear()) {
    return `${dmy.format(start)} – ${dmy.format(end)}`;
  }
  return `${dm.format(start)} – ${dmy.format(end)}`;
}
