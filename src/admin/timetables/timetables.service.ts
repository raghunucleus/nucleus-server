import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { AttendanceGroup } from '../entities/attendance-group.entity';
import { Employee } from '../entities/employee.entity';
import { ProgrammeSemester } from '../entities/programme-semester.entity';
import { ProgrammeSemesterSubject } from '../entities/programme-semester-subject.entity';
import { ProgrammeSemesterSubjectGroupFaculty } from '../entities/programme-semester-subject-group-faculty.entity';
import { Subject } from '../entities/subject.entity';
import { Timetable } from '../entities/timetable.entity';
import { TimetableCourse } from '../entities/timetable-course.entity';
import { TimetableCourseFaculty } from '../entities/timetable-course-faculty.entity';
import { TimetableEntry } from '../entities/timetable-entry.entity';
import { TimetablePeriod } from '../entities/timetable-period.entity';

// A date far enough in the future to stand in for "open-ended" when
// comparing effective ranges in SQL.
const DATE_INFINITY = '9999-12-31';

export interface TimetableSummary extends Timetable {
  period_count: number;
  teaching_period_count: number;
  entry_count: number;
}

interface PeriodInput {
  label: string;
  start_time: string;
  end_time: string;
  is_break: boolean;
}

interface CreateInput {
  programme_semester_id: number;
  attendance_group_id: number;
  name: string;
  effective_from: string;
  effective_to: string | null;
  working_days: number[];
  periods: PeriodInput[];
}

interface UpdateInput {
  name?: string;
  effective_from?: string;
  effective_to?: string | null;
  working_days?: number[];
}

interface SavePeriodInput extends PeriodInput {
  id?: number;
}

interface CreateCourseInput {
  subject_id?: number;
  custom_label?: string;
  employee_ids: number[];
}

interface UpdateCourseInput {
  subject_id?: number | null;
  custom_label?: string | null;
}

interface EntryInput {
  day_of_week: number;
  timetable_period_id: number;
  span: number;
  programme_semester_subject_id?: number;
  timetable_course_id?: number;
  employee_id: number | null;
  room: string | null;
  note: string | null;
}

interface DuplicateInput {
  name: string;
  effective_from: string;
  effective_to: string | null;
  attendance_group_id?: number;
}

@Injectable()
export class TimetablesService {
  constructor(
    @InjectRepository(Timetable)
    private readonly timetables: Repository<Timetable>,
    @InjectRepository(TimetablePeriod)
    private readonly periods: Repository<TimetablePeriod>,
    @InjectRepository(TimetableCourse)
    private readonly courses: Repository<TimetableCourse>,
    @InjectRepository(TimetableEntry)
    private readonly entries: Repository<TimetableEntry>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    @InjectRepository(AttendanceGroup)
    private readonly attendanceGroups: Repository<AttendanceGroup>,
    @InjectRepository(ProgrammeSemesterSubject)
    private readonly semesterSubjects: Repository<ProgrammeSemesterSubject>,
    @InjectRepository(ProgrammeSemesterSubjectGroupFaculty)
    private readonly groupFaculty: Repository<ProgrammeSemesterSubjectGroupFaculty>,
    @InjectRepository(Subject)
    private readonly subjects: Repository<Subject>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    private readonly dataSource: DataSource,
  ) {}

  // --- reads ----------------------------------------------------------------

  // Timetables for a semester (and optionally one attendance group), each
  // carrying lightweight counts for the list cards. Ordered by group, then by
  // effective date so a group's revisions read as a timeline.
  async list(
    programmeSemesterId?: number,
    attendanceGroupId?: number,
  ): Promise<TimetableSummary[]> {
    const qb = this.timetables
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.attendance_group', 'attendance_group')
      .leftJoinAndSelect('t.programme_semester', 'programme_semester');
    if (programmeSemesterId !== undefined) {
      qb.andWhere('t.programme_semester_id = :psid', { psid: programmeSemesterId });
    }
    if (attendanceGroupId !== undefined) {
      qb.andWhere('t.attendance_group_id = :agid', { agid: attendanceGroupId });
    }
    qb.orderBy('attendance_group.name', 'ASC')
      .addOrderBy('t.effective_from', 'ASC')
      .addOrderBy('t.id', 'ASC');
    const rows = await qb.getMany();
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const periodCounts = await this.periods
      .createQueryBuilder('p')
      .select('p.timetable_id', 'tid')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE p.is_break = false)', 'teaching')
      .where('p.timetable_id IN (:...ids)', { ids })
      .groupBy('p.timetable_id')
      .getRawMany<{ tid: string; total: string; teaching: string }>();
    const entryCounts = await this.entries
      .createQueryBuilder('e')
      .select('e.timetable_id', 'tid')
      .addSelect('COUNT(*)', 'total')
      .where('e.timetable_id IN (:...ids)', { ids })
      .groupBy('e.timetable_id')
      .getRawMany<{ tid: string; total: string }>();

    const periodMap = new Map(
      periodCounts.map((r) => [
        Number(r.tid),
        { total: Number(r.total), teaching: Number(r.teaching) },
      ]),
    );
    const entryMap = new Map(
      entryCounts.map((r) => [Number(r.tid), Number(r.total)]),
    );

    return rows.map((t) => ({
      ...t,
      period_count: periodMap.get(t.id)?.total ?? 0,
      teaching_period_count: periodMap.get(t.id)?.teaching ?? 0,
      entry_count: entryMap.get(t.id) ?? 0,
    }));
  }

  // One timetable with its full graph: periods, exclusive courses (+ faculty)
  // and filled cells. This is the payload the editor renders as the live grid.
  async getOne(id: number): Promise<Timetable> {
    const tt = await this.loadOr404(id);
    return this.attachGraph(tt);
  }

  // --- timetable lifecycle --------------------------------------------------

  async create(input: CreateInput): Promise<Timetable> {
    const ps = await this.programmeSemesters.findOne({
      where: { id: input.programme_semester_id },
    });
    if (!ps) {
      throw new BadRequestException('Selected programme semester does not exist');
    }
    const group = await this.attendanceGroups.findOne({
      where: { id: input.attendance_group_id },
    });
    if (!group) {
      throw new BadRequestException('Selected attendance group does not exist');
    }
    this.assertSameBatch(ps, group);

    const savedId = await this.dataSource.transaction(async (tx) => {
      const ttRepo = tx.getRepository(Timetable);
      const periodRepo = tx.getRepository(TimetablePeriod);
      const tt = await ttRepo.save(
        ttRepo.create({
          programme_semester_id: input.programme_semester_id,
          attendance_group_id: input.attendance_group_id,
          name: input.name,
          effective_from: input.effective_from,
          effective_to: input.effective_to,
          status: 'draft',
          working_days: [...input.working_days].sort((a, b) => a - b),
        }),
      );
      await periodRepo.save(
        input.periods.map((p, i) =>
          periodRepo.create({
            timetable_id: tt.id,
            position: i + 1,
            label: p.label,
            start_time: p.start_time,
            end_time: p.end_time,
            is_break: p.is_break,
          }),
        ),
      );
      return tt.id;
    });
    return this.getOne(savedId);
  }

  async update(id: number, patch: UpdateInput): Promise<Timetable> {
    const tt = await this.loadOr404(id);
    this.assertEditable(tt);

    const nextFrom = patch.effective_from ?? tt.effective_from;
    const nextTo =
      patch.effective_to !== undefined ? patch.effective_to : tt.effective_to;
    if (nextTo !== null && nextTo < nextFrom) {
      throw new BadRequestException(
        'effective_to must not be before effective_from',
      );
    }
    const nextDays =
      patch.working_days !== undefined
        ? [...patch.working_days].sort((a, b) => a - b)
        : tt.working_days;

    // A published timetable that moves its dates must still not overlap a
    // sibling published timetable for the same group.
    if (
      tt.status === 'published' &&
      (patch.effective_from !== undefined || patch.effective_to !== undefined)
    ) {
      await this.assertNoEffectiveOverlap(
        tt.attendance_group_id,
        tt.programme_semester_id,
        nextFrom,
        nextTo,
        id,
      );
    }

    await this.dataSource.transaction(async (tx) => {
      if (patch.name !== undefined) tt.name = patch.name;
      tt.effective_from = nextFrom;
      tt.effective_to = nextTo;
      if (patch.working_days !== undefined) {
        tt.working_days = nextDays;
        // Cells on a day that is no longer worked are pruned.
        await tx.getRepository(TimetableEntry).delete({
          timetable_id: id,
          day_of_week: Not(In(nextDays)),
        });
      }
      await tx.getRepository(Timetable).save(tt);
    });
    return this.getOne(id);
  }

  async publish(id: number): Promise<Timetable> {
    const tt = await this.loadOr404(id);
    if (tt.status === 'published') return this.getOne(id);
    if (tt.status === 'archived') {
      throw new ConflictException(
        "Archived timetables can't be published — duplicate it instead.",
      );
    }
    await this.assertNoEffectiveOverlap(
      tt.attendance_group_id,
      tt.programme_semester_id,
      tt.effective_from,
      tt.effective_to,
      id,
    );
    tt.status = 'published';
    await this.timetables.save(tt);
    return this.getOne(id);
  }

  async archive(id: number): Promise<Timetable> {
    const tt = await this.loadOr404(id);
    if (tt.status !== 'archived') {
      tt.status = 'archived';
      await this.timetables.save(tt);
    }
    return this.getOne(id);
  }

  // Clone a timetable into a fresh draft — periods, exclusive courses (+ their
  // faculty) and entries are all copied. Used to plan a future revision or to
  // seed another section's timetable.
  async duplicate(id: number, input: DuplicateInput): Promise<Timetable> {
    const src = await this.loadOr404(id);
    const targetGroupId = input.attendance_group_id ?? src.attendance_group_id;
    const group = await this.attendanceGroups.findOne({
      where: { id: targetGroupId },
    });
    if (!group) {
      throw new BadRequestException('Selected attendance group does not exist');
    }
    this.assertSameBatch(src.programme_semester, group);

    const [periods, courses, entries] = await Promise.all([
      this.periods.find({
        where: { timetable_id: id },
        order: { position: 'ASC' },
      }),
      this.courses.find({
        where: { timetable_id: id },
        relations: { faculty: true },
      }),
      this.entries.find({ where: { timetable_id: id } }),
    ]);

    const newId = await this.dataSource.transaction(async (tx) => {
      const ttRepo = tx.getRepository(Timetable);
      const periodRepo = tx.getRepository(TimetablePeriod);
      const courseRepo = tx.getRepository(TimetableCourse);
      const facultyRepo = tx.getRepository(TimetableCourseFaculty);
      const entryRepo = tx.getRepository(TimetableEntry);

      const clone = await ttRepo.save(
        ttRepo.create({
          programme_semester_id: src.programme_semester_id,
          attendance_group_id: targetGroupId,
          name: input.name,
          effective_from: input.effective_from,
          effective_to: input.effective_to,
          status: 'draft',
          working_days: src.working_days,
        }),
      );

      const periodIdMap = new Map<number, number>();
      for (const p of periods) {
        const np = await periodRepo.save(
          periodRepo.create({
            timetable_id: clone.id,
            position: p.position,
            label: p.label,
            start_time: p.start_time,
            end_time: p.end_time,
            is_break: p.is_break,
          }),
        );
        periodIdMap.set(p.id, np.id);
      }

      const courseIdMap = new Map<number, number>();
      for (const c of courses) {
        const nc = await courseRepo.save(
          courseRepo.create({
            timetable_id: clone.id,
            subject_id: c.subject_id,
            custom_label: c.custom_label,
          }),
        );
        courseIdMap.set(c.id, nc.id);
        if (c.faculty && c.faculty.length > 0) {
          await facultyRepo.save(
            c.faculty.map((f) =>
              facultyRepo.create({
                timetable_course_id: nc.id,
                employee_id: f.employee_id,
              }),
            ),
          );
        }
      }

      // Semester-subject ids carry over unchanged (same semester); period and
      // course ids are remapped to the clone's fresh rows.
      for (const e of entries) {
        await entryRepo.save(
          entryRepo.create({
            timetable_id: clone.id,
            day_of_week: e.day_of_week,
            timetable_period_id: periodIdMap.get(e.timetable_period_id)!,
            span: e.span,
            programme_semester_subject_id: e.programme_semester_subject_id,
            timetable_course_id:
              e.timetable_course_id !== null
                ? (courseIdMap.get(e.timetable_course_id) ?? null)
                : null,
            employee_id: e.employee_id,
            room: e.room,
            note: e.note,
          }),
        );
      }
      return clone.id;
    });
    return this.getOne(newId);
  }

  async remove(id: number): Promise<void> {
    const tt = await this.timetables.findOne({ where: { id } });
    if (!tt) throw new NotFoundException('Timetable not found');
    // periods, courses, course faculty and entries all cascade.
    await this.timetables.remove(tt);
  }

  // --- bell schedule --------------------------------------------------------

  // Replace the period rows. Rows with an `id` are updated in place so their
  // scheduled cells survive; rows without one are inserted; existing rows
  // absent from the payload are deleted (their cells cascade away). Array
  // order sets each row's position.
  async savePeriods(
    id: number,
    incoming: SavePeriodInput[],
  ): Promise<Timetable> {
    const tt = await this.loadOr404(id);
    this.assertEditable(tt);

    await this.dataSource.transaction(async (tx) => {
      const periodRepo = tx.getRepository(TimetablePeriod);
      const entryRepo = tx.getRepository(TimetableEntry);
      const existing = await periodRepo.find({ where: { timetable_id: id } });
      const existingIds = new Set(existing.map((p) => p.id));
      const keptIds = new Set(
        incoming
          .filter((p) => p.id !== undefined)
          .map((p) => p.id as number),
      );

      for (const p of incoming) {
        if (p.id !== undefined && !existingIds.has(p.id)) {
          throw new BadRequestException(
            `Period ${p.id} does not belong to this timetable`,
          );
        }
      }

      // 1. Park every kept row at a negative position so the final
      //    assignment below (positions 1..n) can't trip the
      //    (timetable_id, position) unique. Negatives stay within smallint
      //    and never collide with the positive final positions.
      let parkPosition = -1;
      for (const p of existing) {
        if (keptIds.has(p.id)) {
          await periodRepo.update(p.id, { position: parkPosition });
          parkPosition -= 1;
        }
      }
      // 2. Drop rows removed from the payload (cells cascade).
      const toDelete = existing.filter((p) => !keptIds.has(p.id));
      if (toDelete.length > 0) {
        await periodRepo.delete(toDelete.map((p) => p.id));
      }
      // 3. Write final positions — update kept rows, insert new ones.
      for (let i = 0; i < incoming.length; i++) {
        const p = incoming[i];
        if (p.id !== undefined) {
          await periodRepo.update(p.id, {
            position: i + 1,
            label: p.label,
            start_time: p.start_time,
            end_time: p.end_time,
            is_break: p.is_break,
          });
        } else {
          await periodRepo.save(
            periodRepo.create({
              timetable_id: id,
              position: i + 1,
              label: p.label,
              start_time: p.start_time,
              end_time: p.end_time,
              is_break: p.is_break,
            }),
          );
        }
      }
      // 4. A row flipped to a break can't keep its scheduled classes.
      const breakIds = incoming
        .filter((p) => p.id !== undefined && p.is_break)
        .map((p) => p.id as number);
      if (breakIds.length > 0) {
        await entryRepo.delete({
          timetable_id: id,
          timetable_period_id: In(breakIds),
        });
      }
      // 5. A period change can leave a merged class covering a break or
      //    running off the end — clamp each span to its still-valid run.
      const finalPeriods = await periodRepo.find({
        where: { timetable_id: id },
        order: { position: 'ASC' },
      });
      const remaining = await entryRepo.find({ where: { timetable_id: id } });
      for (const e of remaining) {
        if (e.span <= 1) continue;
        const idx = finalPeriods.findIndex(
          (p) => p.id === e.timetable_period_id,
        );
        if (idx < 0) continue;
        let validSpan = 1;
        for (let k = 1; k < e.span; k++) {
          const p = finalPeriods[idx + k];
          if (!p || p.is_break) break;
          validSpan = k + 1;
        }
        if (validSpan !== e.span) {
          await entryRepo.update(e.id, { span: validSpan });
        }
      }
    });
    return this.getOne(id);
  }

  // --- exclusive courses ----------------------------------------------------

  async createCourse(
    timetableId: number,
    input: CreateCourseInput,
  ): Promise<Timetable> {
    const tt = await this.loadOr404(timetableId);
    this.assertEditable(tt);
    // A timetable-exclusive subject has no semester faculty allocation to
    // fall back on, so at least one teacher must be mapped up-front.
    if (input.employee_ids.length === 0) {
      throw new BadRequestException(
        'Pick at least one faculty member for this subject.',
      );
    }
    if (input.subject_id !== undefined) {
      const subject = await this.subjects.findOne({
        where: { id: input.subject_id },
      });
      if (!subject) {
        throw new BadRequestException('Selected subject does not exist');
      }
    }
    await this.assertEmployeesAllocatable(input.employee_ids);

    await this.dataSource.transaction(async (tx) => {
      const courseRepo = tx.getRepository(TimetableCourse);
      const facultyRepo = tx.getRepository(TimetableCourseFaculty);
      const course = await courseRepo.save(
        courseRepo.create({
          timetable_id: timetableId,
          subject_id: input.subject_id ?? null,
          custom_label: input.custom_label ?? null,
        }),
      );
      if (input.employee_ids.length > 0) {
        await facultyRepo.save(
          input.employee_ids.map((eid) =>
            facultyRepo.create({
              timetable_course_id: course.id,
              employee_id: eid,
            }),
          ),
        );
      }
    });
    return this.getOne(timetableId);
  }

  async updateCourse(
    courseId: number,
    patch: UpdateCourseInput,
  ): Promise<Timetable> {
    const course = await this.courses.findOne({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Timetable course not found');
    const tt = await this.loadOr404(course.timetable_id);
    this.assertEditable(tt);

    const nextSubjectId =
      patch.subject_id !== undefined ? patch.subject_id : course.subject_id;
    const nextLabel =
      patch.custom_label !== undefined ? patch.custom_label : course.custom_label;
    const hasSubject = nextSubjectId !== null && nextSubjectId !== undefined;
    const hasLabel =
      nextLabel !== null && nextLabel !== undefined && nextLabel !== '';
    if (hasSubject === hasLabel) {
      throw new BadRequestException(
        'Provide exactly one of subject_id (master subject) or custom_label (free-text)',
      );
    }
    if (
      hasSubject &&
      patch.subject_id !== undefined &&
      patch.subject_id !== null &&
      patch.subject_id !== course.subject_id
    ) {
      const subject = await this.subjects.findOne({
        where: { id: patch.subject_id },
      });
      if (!subject) {
        throw new BadRequestException('Selected subject does not exist');
      }
    }
    course.subject_id = hasSubject ? nextSubjectId! : null;
    course.custom_label = hasSubject ? null : nextLabel!;
    await this.courses.save(course);
    return this.getOne(course.timetable_id);
  }

  async removeCourse(courseId: number): Promise<Timetable> {
    const course = await this.courses.findOne({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Timetable course not found');
    const tt = await this.loadOr404(course.timetable_id);
    this.assertEditable(tt);
    const timetableId = course.timetable_id;
    // Faculty links and any cells using this course cascade away.
    await this.courses.remove(course);
    return this.getOne(timetableId);
  }

  // Replace an exclusive course's faculty roster. Cells that named a teacher
  // who is no longer on the roster have their teacher cleared.
  async setCourseFaculty(
    courseId: number,
    employeeIds: number[],
  ): Promise<Timetable> {
    const course = await this.courses.findOne({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Timetable course not found');
    const tt = await this.loadOr404(course.timetable_id);
    this.assertEditable(tt);
    if (employeeIds.length === 0) {
      throw new BadRequestException(
        'A timetable subject must keep at least one faculty member.',
      );
    }
    await this.assertEmployeesAllocatable(employeeIds);

    await this.dataSource.transaction(async (tx) => {
      const facultyRepo = tx.getRepository(TimetableCourseFaculty);
      await facultyRepo.delete({ timetable_course_id: courseId });
      if (employeeIds.length > 0) {
        await facultyRepo.save(
          employeeIds.map((eid) =>
            facultyRepo.create({
              timetable_course_id: courseId,
              employee_id: eid,
            }),
          ),
        );
      }
      const orphan = tx
        .getRepository(TimetableEntry)
        .createQueryBuilder()
        .update()
        .set({ employee_id: null })
        .where('timetable_course_id = :cid', { cid: courseId })
        .andWhere('employee_id IS NOT NULL');
      if (employeeIds.length > 0) {
        orphan.andWhere('employee_id NOT IN (:...ids)', { ids: employeeIds });
      }
      await orphan.execute();
    });
    return this.getOne(course.timetable_id);
  }

  // --- grid cells -----------------------------------------------------------

  // Place (or replace) the class in one cell. Returns just the upserted entry
  // so the editor can splice it into the live grid.
  async upsertEntry(
    timetableId: number,
    input: EntryInput,
  ): Promise<TimetableEntry> {
    const tt = await this.loadOr404(timetableId);
    this.assertEditable(tt);

    if (!tt.working_days.includes(input.day_of_week)) {
      throw new BadRequestException(
        'That day is not a working day of this timetable',
      );
    }
    const period = await this.periods.findOne({
      where: { id: input.timetable_period_id },
    });
    if (!period || period.timetable_id !== timetableId) {
      throw new BadRequestException(
        'That period does not belong to this timetable',
      );
    }
    if (period.is_break) {
      throw new BadRequestException("A break period can't hold a class");
    }

    // Resolve the run of periods this class occupies (span >= 1). A merged
    // class can't run past the day's last period or cross a break.
    const orderedPeriods = await this.periods.find({
      where: { timetable_id: timetableId },
      order: { position: 'ASC' },
    });
    const startIndex = orderedPeriods.findIndex(
      (p) => p.id === input.timetable_period_id,
    );
    const coveredPeriods = orderedPeriods.slice(
      startIndex,
      startIndex + input.span,
    );
    if (coveredPeriods.length < input.span) {
      throw new BadRequestException(
        'The class spans more periods than the day has after its start.',
      );
    }
    if (coveredPeriods.some((p) => p.is_break)) {
      throw new BadRequestException("A merged class can't cover a break.");
    }

    let pssId: number | null = null;
    let courseId: number | null = null;
    let validFacultyIds: number[] = [];
    let isElectiveSlot = false;

    if (input.programme_semester_subject_id !== undefined) {
      const pss = await this.semesterSubjects.findOne({
        where: { id: input.programme_semester_subject_id },
      });
      if (!pss || pss.programme_semester_id !== tt.programme_semester_id) {
        throw new BadRequestException(
          "That subject is not part of this timetable's semester",
        );
      }
      pssId = pss.id;
      isElectiveSlot = pss.subject_id === null;
      // Faculty is now allocated per (subject, attendance group). The
      // timetable is bound to one group, so the valid teacher for this cell
      // is the one assigned to (subject, this timetable's group) — at most
      // one row in the matrix table.
      if (!isElectiveSlot) {
        const cell = await this.groupFaculty.findOne({
          where: {
            programme_semester_subject_id: pss.id,
            attendance_group_id: tt.attendance_group_id,
          },
        });
        validFacultyIds = cell ? [cell.employee_id] : [];
      }
    } else {
      const course = await this.courses
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.faculty', 'faculty')
        .where('c.id = :id', { id: input.timetable_course_id })
        .getOne();
      if (!course || course.timetable_id !== timetableId) {
        throw new BadRequestException(
          'That course does not belong to this timetable',
        );
      }
      courseId = course.id;
      validFacultyIds = (course.faculty ?? []).map((f) => f.employee_id);
    }

    if (isElectiveSlot) {
      // An open-elective slot has no single teacher — it must stay empty.
      if (input.employee_id !== null) {
        throw new BadRequestException(
          'Open-elective slots carry no single teacher — leave the teacher empty.',
        );
      }
    } else {
      // Every real subject must name a teacher.
      if (input.employee_id === null) {
        throw new BadRequestException('Pick a teacher for this class.');
      }
      if (!validFacultyIds.includes(input.employee_id)) {
        throw new BadRequestException(
          'That teacher is not allocated to the selected subject.',
        );
      }
    }

    const entryId = await this.dataSource.transaction(async (tx) => {
      const entryRepo = tx.getRepository(TimetableEntry);
      const indexById = new Map(orderedPeriods.map((p, i) => [p.id, i]));
      const newStart = startIndex;
      const newEnd = startIndex + input.span - 1;
      // Drop every entry on this day whose own run overlaps the new run —
      // the one being replaced, plus any merged class the new span absorbs.
      const dayEntries = await entryRepo.find({
        where: { timetable_id: timetableId, day_of_week: input.day_of_week },
      });
      const conflicting = dayEntries.filter((e) => {
        const idx = indexById.get(e.timetable_period_id);
        if (idx === undefined) return false;
        return idx <= newEnd && newStart <= idx + (e.span - 1);
      });
      if (conflicting.length > 0) {
        await entryRepo.delete(conflicting.map((e) => e.id));
      }
      const created = await entryRepo.save(
        entryRepo.create({
          timetable_id: timetableId,
          day_of_week: input.day_of_week,
          timetable_period_id: input.timetable_period_id,
          span: input.span,
          programme_semester_subject_id: pssId,
          timetable_course_id: courseId,
          employee_id: input.employee_id,
          room: input.room,
          note: input.note,
        }),
      );
      return created.id;
    });
    return this.getOneEntry(entryId);
  }

  async clearEntry(
    timetableId: number,
    dayOfWeek: number,
    periodId: number,
  ): Promise<void> {
    const tt = await this.loadOr404(timetableId);
    this.assertEditable(tt);
    await this.entries.delete({
      timetable_id: timetableId,
      day_of_week: dayOfWeek,
      timetable_period_id: periodId,
    });
  }

  // --- helpers --------------------------------------------------------------

  private async loadOr404(id: number): Promise<Timetable> {
    const tt = await this.timetables.findOne({ where: { id } });
    if (!tt) throw new NotFoundException('Timetable not found');
    return tt;
  }

  private assertEditable(tt: Timetable): void {
    if (tt.status === 'archived') {
      throw new ConflictException(
        'Archived timetables are read-only — duplicate it to make changes.',
      );
    }
  }

  private assertSameBatch(
    ps: ProgrammeSemester,
    group: AttendanceGroup,
  ): void {
    if (
      ps.programme_id !== group.programme_id ||
      ps.admission_year_id !== group.admission_year_id
    ) {
      throw new BadRequestException(
        'The attendance group and semester belong to different programme batches.',
      );
    }
  }

  // No two *published* timetables for the same group × semester may have
  // overlapping effective ranges (null effective_to = open-ended).
  private async assertNoEffectiveOverlap(
    attendanceGroupId: number,
    programmeSemesterId: number,
    from: string,
    to: string | null,
    excludeId: number,
  ): Promise<void> {
    const clash = await this.timetables
      .createQueryBuilder('t')
      .where('t.attendance_group_id = :gid', { gid: attendanceGroupId })
      .andWhere('t.programme_semester_id = :psid', { psid: programmeSemesterId })
      .andWhere("t.status = 'published'")
      .andWhere('t.id <> :id', { id: excludeId })
      // Cast the string params to `date` — COALESCE of two untyped params
      // defaults to `text`, which has no `<=` against a `date` column.
      .andWhere(
        't.effective_from <= COALESCE(CAST(:to AS date), CAST(:inf AS date))',
        { to, inf: DATE_INFINITY },
      )
      .andWhere(
        'COALESCE(t.effective_to, CAST(:inf AS date)) >= CAST(:from AS date)',
        { from, inf: DATE_INFINITY },
      )
      .getOne();
    if (clash) {
      throw new ConflictException(
        `These effective dates overlap the published timetable "${clash.name}". Adjust the dates so published timetables for this group don't overlap.`,
      );
    }
  }

  private async assertEmployeesAllocatable(
    employeeIds: number[],
  ): Promise<void> {
    if (employeeIds.length === 0) return;
    const found = await this.employees
      .createQueryBuilder('e')
      .where('e.id IN (:...ids)', { ids: employeeIds })
      .getMany();
    const byId = new Map(found.map((e) => [e.id, e]));
    const missing = employeeIds.filter((eid) => !byId.has(eid));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown faculty id(s): ${missing.join(', ')}`,
      );
    }
    const inactive = employeeIds
      .map((eid) => byId.get(eid)!)
      .filter((e) => !e.is_active);
    if (inactive.length > 0) {
      throw new BadRequestException(
        `Inactive faculty can't be allocated: ${inactive
          .map((e) => e.emp_code)
          .join(', ')}`,
      );
    }
  }

  // Load periods, courses (+ faculty) and entries for one timetable. Fetched
  // as three queries — joining all three in one would fan out into a
  // cartesian product.
  private async attachGraph(tt: Timetable): Promise<Timetable> {
    const [periods, courses, entries] = await Promise.all([
      this.periods.find({
        where: { timetable_id: tt.id },
        order: { position: 'ASC' },
      }),
      this.courses
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.subject', 'subject')
        .leftJoinAndSelect('c.faculty', 'faculty')
        .leftJoinAndSelect('faculty.employee', 'faculty_employee')
        .where('c.timetable_id = :id', { id: tt.id })
        .orderBy('c.id', 'ASC')
        .addOrderBy('faculty.id', 'ASC')
        .getMany(),
      this.entries
        .createQueryBuilder('e')
        .leftJoinAndSelect('e.programme_semester_subject', 'pss')
        .leftJoinAndSelect('pss.subject', 'pss_subject')
        .leftJoinAndSelect('e.timetable_course', 'course')
        .leftJoinAndSelect('course.subject', 'course_subject')
        .leftJoinAndSelect('e.employee', 'employee')
        .where('e.timetable_id = :id', { id: tt.id })
        .orderBy('e.day_of_week', 'ASC')
        .getMany(),
    ]);
    tt.periods = periods;
    tt.courses = courses;
    tt.entries = entries;
    return tt;
  }

  private async getOneEntry(id: number): Promise<TimetableEntry> {
    const entry = await this.entries
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.programme_semester_subject', 'pss')
      .leftJoinAndSelect('pss.subject', 'pss_subject')
      .leftJoinAndSelect('e.timetable_course', 'course')
      .leftJoinAndSelect('course.subject', 'course_subject')
      .leftJoinAndSelect('e.employee', 'employee')
      .where('e.id = :id', { id })
      .getOne();
    if (!entry) throw new NotFoundException('Timetable entry not found');
    return entry;
  }
}
