import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { AttendanceGroup } from '../entities/attendance-group.entity';
import { ClassSession } from '../entities/class-session.entity';
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
import {
  PreviewResult,
  PublishResult,
  type SeedWindow,
  SessionSeederService,
} from '../sessions/session-seeder.service';

// One week's worth of class session metadata for the strip view. Counts
// drive the "Published / Partial / Empty" badge; cancellations/completions
// surface separately so the admin can spot a partial roll-out.
export interface WeekSummary {
  week_start: string;   // 'YYYY-MM-DD', a Monday
  week_end: string;     // 'YYYY-MM-DD', the corresponding Sunday
  scheduled: number;
  completed: number;
  cancelled: number;
  rescheduled: number;
  // True when at least one session exists for the window. Empty weeks mean
  // "never published / no sessions inserted" — the admin can publish them
  // from the strip view.
  has_any: boolean;
  // Templates that produced sessions in this week. Usually one entry; rare
  // multi-template weeks (e.g. mid-week template switch) carry both.
  templates: { id: number; name: string; session_count: number }[];
}

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
  working_days: number[];
  periods: PeriodInput[];
}

interface UpdateInput {
  name?: string;
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
    private readonly sessionSeeder: SessionSeederService,
  ) {}

  // --- reads ----------------------------------------------------------------

  // Timetables for a semester (and optionally one attendance group), each
  // carrying lightweight counts for the list cards. One timetable per
  // (ps, group) — the list is just "groups in this semester that have a
  // timetable yet."
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
    qb.orderBy('attendance_group.name', 'ASC').addOrderBy('t.id', 'ASC');
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

    // First template for this group becomes default automatically. Later
    // templates can be promoted via the setDefault endpoint.
    const existingCount = await this.timetables.count({
      where: {
        programme_semester_id: input.programme_semester_id,
        attendance_group_id: input.attendance_group_id,
      },
    });
    const shouldBeDefault = existingCount === 0;

    const savedId = await this.dataSource.transaction(async (tx) => {
      const ttRepo = tx.getRepository(Timetable);
      const periodRepo = tx.getRepository(TimetablePeriod);
      const tt = await ttRepo.save(
        ttRepo.create({
          programme_semester_id: input.programme_semester_id,
          attendance_group_id: input.attendance_group_id,
          name: input.name,
          is_default: shouldBeDefault,
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

  // Promote a template to be the group's default. Within a transaction the
  // previous default is unset first so the partial unique index never
  // fires mid-operation.
  async setDefault(id: number): Promise<Timetable> {
    const tt = await this.loadOr404(id);
    if (tt.is_default) return this.getOne(id);
    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(Timetable);
      await repo
        .createQueryBuilder()
        .update()
        .set({ is_default: false })
        .where('programme_semester_id = :psid', { psid: tt.programme_semester_id })
        .andWhere('attendance_group_id = :gid', { gid: tt.attendance_group_id })
        .andWhere('is_default = TRUE')
        .execute();
      await repo.update(id, { is_default: true });
    });
    return this.getOne(id);
  }

  async update(id: number, patch: UpdateInput): Promise<Timetable> {
    const tt = await this.loadOr404(id);
    const nextDays =
      patch.working_days !== undefined
        ? [...patch.working_days].sort((a, b) => a - b)
        : tt.working_days;

    await this.dataSource.transaction(async (tx) => {
      if (patch.name !== undefined) tt.name = patch.name;
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

  // --- per-week publish flow -----------------------------------------------

  // Preview what publishing `week_start..week_end` would create. Returns
  // the would-be sessions + holidays in the window + a flag per session
  // indicating whether an identical session already exists.
  async previewWeek(
    id: number,
    week: { from: string; to: string; days_of_week?: number[] },
  ): Promise<PreviewResult> {
    await this.loadOr404(id);
    return this.sessionSeeder.previewWindow(id, week);
  }

  // Commit the week. Replaces any still-scheduled sessions from this
  // timetable's entries in the window with the current shape (subject /
  // teacher / room edits picked up); completed and cancelled sessions
  // stay untouched. When `days_of_week` is supplied the wipe + seed are
  // restricted to those weekdays. Idempotent.
  async publishWeek(id: number, week: SeedWindow): Promise<PublishResult> {
    await this.loadOr404(id);
    return this.sessionSeeder.publishWindow(id, week);
  }

  // Per-week roll-up of session statuses across a date range — drives the
  // strip-view badges. The summary is group-level: any template the group
  // has counts toward the same buckets, so calling this with template A or
  // template B of the same group returns the same data. `templates`
  // surfaces which template each week was published from (multi-template
  // weeks list both, with their respective counts).
  async getWeekSummaries(
    id: number,
    week_starts: string[],
  ): Promise<WeekSummary[]> {
    if (week_starts.length === 0) return [];
    const tt = await this.loadOr404(id);
    const ranges = week_starts.map((ws) => ({
      week_start: ws,
      week_end: addDaysISO(ws, 6),
    }));
    const overallFrom = ranges
      .map((r) => r.week_start)
      .reduce((a, b) => (a < b ? a : b));
    const overallTo = ranges
      .map((r) => r.week_end)
      .reduce((a, b) => (a > b ? a : b));

    // Group-scoped sessions, including cross-group elective sessions whose
    // entry sits on one of this group's templates.
    const rows = await this.dataSource.query<
      Array<{ session_date: string; status: string; timetable_id: number | null; timetable_name: string | null }>
    >(
      `SELECT
         cs.session_date::text AS session_date,
         cs.status,
         t.id AS timetable_id,
         t.name AS timetable_name
       FROM "class_sessions" cs
       LEFT JOIN "timetable_entries" te ON te.id = cs.timetable_entry_id
       LEFT JOIN "timetables" t ON t.id = te.timetable_id
       WHERE cs.session_date BETWEEN $3 AND $4
         AND (
           cs.attendance_group_id = $1
           OR (cs.attendance_group_id IS NULL AND cs.programme_semester_id = $2 AND t.attendance_group_id = $1)
         )`,
      [tt.attendance_group_id, tt.programme_semester_id, overallFrom, overallTo],
    );

    const out: WeekSummary[] = ranges.map((r) => ({
      week_start: r.week_start,
      week_end: r.week_end,
      scheduled: 0,
      completed: 0,
      cancelled: 0,
      rescheduled: 0,
      has_any: false,
      templates: [],
    }));
    // Per-week per-template tallies kept on the side; folded into the bucket
    // at the end so JSON ordering is stable (no Map iteration leakage).
    const perBucket = new Map<
      WeekSummary,
      Map<number, { name: string; count: number }>
    >();
    for (const row of rows) {
      const bucket = out.find(
        (b) => row.session_date >= b.week_start && row.session_date <= b.week_end,
      );
      if (!bucket) continue;
      bucket.has_any = true;
      if (row.status === 'scheduled') bucket.scheduled += 1;
      else if (row.status === 'completed') bucket.completed += 1;
      else if (row.status === 'cancelled') bucket.cancelled += 1;
      else if (row.status === 'rescheduled') bucket.rescheduled += 1;
      if (row.timetable_id !== null && row.timetable_name !== null) {
        let perTt = perBucket.get(bucket);
        if (!perTt) {
          perTt = new Map();
          perBucket.set(bucket, perTt);
        }
        const ttKey = Number(row.timetable_id);
        const existing = perTt.get(ttKey);
        if (existing) existing.count += 1;
        else perTt.set(ttKey, { name: row.timetable_name, count: 1 });
      }
    }
    for (const [bucket, perTt] of perBucket) {
      bucket.templates = Array.from(perTt.entries())
        .map(([id, v]) => ({ id, name: v.name, session_count: v.count }))
        .sort((a, b) => b.session_count - a.session_count);
    }
    return out;
  }

  async remove(id: number): Promise<void> {
    const tt = await this.timetables.findOne({ where: { id } });
    if (!tt) throw new NotFoundException('Timetable not found');
    await this.dataSource.transaction(async (tx) => {
      // Future, still-scheduled sessions seeded from this template would
      // otherwise be orphaned — the FK sets their timetable_entry_id to NULL,
      // and the publish wipe only deletes rows with a non-null entry, so they
      // linger forever as stale periods on students' timetables. Drop them
      // first. Completed/cancelled sessions are left as history.
      await tx.query(
        `DELETE FROM "class_sessions"
         WHERE status = 'scheduled'
           AND session_date >= CURRENT_DATE
           AND timetable_entry_id IN (
             SELECT id FROM "timetable_entries" WHERE timetable_id = $1
           )`,
        [id],
      );
      // periods, courses, course faculty and entries all cascade.
      await tx.getRepository(Timetable).remove(tt);
    });
  }

  // Clone an existing template into a fresh one in the same group. Periods,
  // exclusive courses (+ their faculty) and grid cells are all copied. The
  // caller picks a new name; everything else carries over so the admin can
  // tweak the copy for a special variant (e.g. clone "Regular week" → "Exam
  // week" and rejig periods/cells).
  async clone(id: number, input: { name: string }): Promise<Timetable> {
    const src = await this.loadOr404(id);

    // Block exact-name collisions in the same group so the list reads cleanly.
    const sibling = await this.timetables.findOne({
      where: {
        programme_semester_id: src.programme_semester_id,
        attendance_group_id: src.attendance_group_id,
        name: input.name.trim(),
      },
    });
    if (sibling) {
      throw new ConflictException(
        `A template named "${input.name}" already exists for this group.`,
      );
    }

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
          attendance_group_id: src.attendance_group_id,
          name: input.name.trim(),
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

      // Semester-subject ids carry over unchanged (same PS); period and
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
      // Faculty is allocated per (subject, attendance group), so the
      // primary teacher for a cell is "this subject × this group". To make
      // covering for an absent teacher easy, we also allow any teacher
      // allocated to the same subject for ANOTHER group ("borrowed"). The
      // editor presents the group's own teacher first and labels alternates.
      if (!isElectiveSlot) {
        const cells = await this.groupFaculty.find({
          where: { programme_semester_subject_id: pss.id },
        });
        validFacultyIds = cells.map((c) => c.employee_id);
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

function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map((p) => Number(p));
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
