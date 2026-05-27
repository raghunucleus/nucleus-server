import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AcademicHoliday } from '../entities/academic-holiday.entity';
import { ClassSession } from '../entities/class-session.entity';
import { Employee } from '../entities/employee.entity';
import { ProgrammeSemesterSubject } from '../entities/programme-semester-subject.entity';
import { Subject } from '../entities/subject.entity';
import { Timetable } from '../entities/timetable.entity';
import { TimetableEntry } from '../entities/timetable-entry.entity';
import { TimetablePeriod } from '../entities/timetable-period.entity';

export interface SeedWindow {
  from: string; // 'YYYY-MM-DD', inclusive
  to: string;   // 'YYYY-MM-DD', inclusive
}

// Snapshot of one would-be session, used by the preview endpoint so the
// admin sees exactly what publishing this week will create. Names are
// hydrated server-side so the admin UI doesn't render raw ids.
export interface PreviewSession {
  session_date: string;
  day_of_week: number;
  timetable_period_id: number;
  // Bell-schedule context for the cell.
  period_label: string | null;
  period_start_time: string | null;
  period_end_time: string | null;
  span: number;
  timetable_entry_id: number;
  programme_semester_subject_id: number;
  programme_semester_subject_option_id: number | null;
  // Parent slot's placeholder name (e.g. "Open Elective 1") when this row
  // is an elective cohort — null for regular sessions. Lets the preview UI
  // group cohorts under their slot rather than listing each per-teacher row.
  slot_placeholder_name: string | null;
  subject_id: number;
  // The actual subject delivered by this session — code and human name.
  subject_code: string | null;
  subject_name: string | null;
  scheduled_employee_id: number;
  teacher_name: string | null;
  teacher_emp_code: string | null;
  room: string | null;
  // True if a session with the same UQ_class_sessions_key already exists,
  // so the admin knows clicking Publish is a no-op for this row.
  already_exists: boolean;
}

export interface PreviewResult {
  sessions: PreviewSession[];
  holidays: { date: string; name: string; end_date: string | null }[];
  // Dates inside [from, to] that produce no sessions because of a holiday
  // covering them entirely.
  blocked_dates: string[];
}

export interface PublishResult {
  inserted: number;
  skipped_holidays: number;
  // Sessions deleted before re-seeding (kept-but-replaced rows from a
  // previous publish that no longer match the current timetable shape).
  replaced: number;
}

// One row pulled per (option, teacher) cohort during elective expansion.
interface CohortRow {
  option_id: number;
  option_subject_id: number;
  employee_id: number;
}

@Injectable()
export class SessionSeederService {
  private readonly logger = new Logger(SessionSeederService.name);

  constructor(
    @InjectRepository(Timetable)
    private readonly timetables: Repository<Timetable>,
    private readonly dataSource: DataSource,
  ) {}

  // Compute what `publishWindow` would produce, without writing anything.
  // Used by the preview button so the admin sees a faithful picture of
  // the week before committing.
  async previewWindow(
    timetableId: number,
    window: SeedWindow,
  ): Promise<PreviewResult> {
    const tt = await this.loadTimetable(timetableId);
    const window2 = this.clampWindow(tt, window);
    if (window2 === null) {
      return { sessions: [], holidays: [], blocked_dates: [] };
    }
    return this.dataSource.transaction(async (tx) => {
      const [entries, holidays] = await Promise.all([
        this.loadEntries(tx, tt.id),
        this.loadApplicableHolidays(tx, tt, window2.from, window2.to),
      ]);
      // First pass: build the raw session rows + existence flag. Names are
      // hydrated in a single batch lookup after the loop so we don't issue
      // N×3 queries per session.
      type RawRow = Awaited<ReturnType<typeof this.expandEntry>>[number] & {
        already_exists: boolean;
      };
      const raw: RawRow[] = [];
      const blockedDates: string[] = [];
      const cohortCache = new Map<number, CohortRow[]>();
      const workingDays = new Set(tt.working_days);
      const entriesByDay = groupEntriesByDay(entries, workingDays);

      for (const date of enumerateDates(window2.from, window2.to)) {
        const weekday = isoWeekday(date);
        const dayEntries = entriesByDay.get(weekday);
        if (!dayEntries || dayEntries.length === 0) continue;
        if (this.dateIsFullyBlocked(holidays, date)) {
          blockedDates.push(date);
          continue;
        }
        for (const entry of dayEntries) {
          for (const row of await this.expandEntry(
            tx,
            tt,
            entry,
            date,
            weekday,
            cohortCache,
          )) {
            raw.push({
              ...row,
              already_exists: await this.sessionExists(tx, row),
            });
          }
        }
      }

      const sessions = await this.hydrateNames(tx, raw);

      return {
        sessions,
        holidays: holidays.map((h) => ({
          date: h.date,
          name: h.name,
          end_date: h.end_date,
        })),
        blocked_dates: blockedDates,
      };
    });
  }

  // Batch-fetch subject / teacher / period names for a set of raw preview
  // rows and merge them in. Keeps the per-row JSON compact while giving the
  // UI everything it needs to render without raw ids.
  private async hydrateNames(
    tx: EntityManager,
    raw: Array<{
      session_date: string;
      day_of_week: number;
      timetable_period_id: number;
      span: number;
      timetable_entry_id: number;
      programme_semester_subject_id: number;
      programme_semester_subject_option_id: number | null;
      slot_placeholder_name: string | null;
      subject_id: number;
      scheduled_employee_id: number;
      room: string | null;
      already_exists: boolean;
    }>,
  ): Promise<PreviewSession[]> {
    if (raw.length === 0) return [];
    const subjectIds = Array.from(new Set(raw.map((r) => r.subject_id)));
    const empIds = Array.from(new Set(raw.map((r) => r.scheduled_employee_id)));
    const periodIds = Array.from(
      new Set(raw.map((r) => r.timetable_period_id)),
    );
    const [subjects, employees, periods] = await Promise.all([
      tx.find(Subject, { where: { id: In(subjectIds) } }),
      tx.find(Employee, { where: { id: In(empIds) } }),
      tx.find(TimetablePeriod, { where: { id: In(periodIds) } }),
    ]);
    const subjMap = new Map(subjects.map((s) => [s.id, s]));
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const periodMap = new Map(periods.map((p) => [p.id, p]));

    return raw.map((r) => {
      const sub = subjMap.get(r.subject_id);
      const emp = empMap.get(r.scheduled_employee_id);
      const period = periodMap.get(r.timetable_period_id);
      return {
        ...r,
        subject_code: sub?.code ?? null,
        subject_name: sub?.name ?? null,
        teacher_name: emp?.emp_display_name ?? null,
        teacher_emp_code: emp?.emp_code ?? null,
        period_label: period?.label ?? null,
        period_start_time: period?.start_time ?? null,
        period_end_time: period?.end_time ?? null,
      };
    });
  }

  // Publish a window. Deletes any existing 'scheduled' (never-marked)
  // sessions in the window that originated from this timetable's entries
  // — so a re-publish picks up edits to subject/teacher cells. Completed
  // and cancelled sessions are left alone (historical truth).
  //
  // Idempotent thanks to UQ_class_sessions_key + the pre-delete: republish
  // never duplicates, and re-applying with unchanged entries is a no-op.
  async publishWindow(
    timetableId: number,
    window: SeedWindow,
  ): Promise<PublishResult> {
    const tt = await this.loadTimetable(timetableId);
    if (tt.programme_semester.status !== 'ongoing') {
      throw new ForbiddenException(
        `Semester is ${tt.programme_semester.status} — start it before publishing weeks.`,
      );
    }
    const clamped = this.clampWindow(tt, window);
    if (clamped === null) {
      throw new BadRequestException(
        'Requested window is outside the semester. Adjust the planned dates or pick a different week.',
      );
    }

    return this.dataSource.transaction(async (tx) => {
      // Wipe still-scheduled sessions for this group's week REGARDLESS of
      // which timetable template produced them. This lets the group incharge
      // switch templates between weeks (Regular vs Exam-week vs ...) without
      // mixing two templates' rows in the same date range.
      //
      // Preserved:
      //   - completed / cancelled sessions (historical truth)
      //   - ad-hoc sessions (timetable_entry_id IS NULL, deliberately
      //     inserted by the incharge as one-off makeups)
      //
      // Wiped:
      //   - regular sessions for this group whose timetable_entry_id is
      //     non-null (template-derived) and whose status is 'scheduled'
      //   - elective cohort sessions whose group is NULL but whose
      //     programme_semester_id matches AND whose entry belonged to a
      //     template of THIS group — captured by the entry's
      //     timetable_id.attendance_group_id filter.
      const wipe = await tx
        .getRepository(ClassSession)
        .createQueryBuilder()
        .delete()
        .where('session_date BETWEEN :from AND :to', {
          from: clamped.from,
          to: clamped.to,
        })
        .andWhere(`status = 'scheduled'`)
        .andWhere('timetable_entry_id IS NOT NULL')
        .andWhere(
          `timetable_entry_id IN (
             SELECT te.id
             FROM timetable_entries te
             JOIN timetables t ON t.id = te.timetable_id
             WHERE t.attendance_group_id = :gid
               AND t.programme_semester_id = :psid
           )`,
          {
            gid: tt.attendance_group_id,
            psid: tt.programme_semester_id,
          },
        )
        .execute();

      const [entries, holidays] = await Promise.all([
        this.loadEntries(tx, tt.id),
        this.loadApplicableHolidays(tx, tt, clamped.from, clamped.to),
      ]);
      let inserted = 0;
      let skippedHolidays = 0;
      const cohortCache = new Map<number, CohortRow[]>();
      const workingDays = new Set(tt.working_days);
      const entriesByDay = groupEntriesByDay(entries, workingDays);

      for (const date of enumerateDates(clamped.from, clamped.to)) {
        const weekday = isoWeekday(date);
        const dayEntries = entriesByDay.get(weekday);
        if (!dayEntries || dayEntries.length === 0) continue;
        if (this.dateIsFullyBlocked(holidays, date)) {
          skippedHolidays += dayEntries.length;
          continue;
        }
        for (const entry of dayEntries) {
          for (const row of await this.expandEntry(
            tx,
            tt,
            entry,
            date,
            weekday,
            cohortCache,
          )) {
            const ok = await this.insertSession(tx, row);
            if (ok) inserted += 1;
          }
        }
      }

      this.logger.log(
        `publishWindow: timetable=${timetableId} range=${clamped.from}..${clamped.to} replaced=${wipe.affected ?? 0} inserted=${inserted} skipped_holidays=${skippedHolidays}`,
      );
      return {
        inserted,
        skipped_holidays: skippedHolidays,
        replaced: wipe.affected ?? 0,
      };
    });
  }

  // --- internals ------------------------------------------------------------

  private async loadTimetable(timetableId: number): Promise<Timetable> {
    const tt = await this.timetables.findOne({
      where: { id: timetableId },
      relations: ['programme_semester', 'attendance_group'],
    });
    if (!tt) throw new NotFoundException('Timetable not found');
    return tt;
  }

  // Clamp the requested window to the semester's planned dates. Returns
  // null when the intersection is empty (entire request lies outside the
  // semester) — callers treat that as "nothing to do" (preview) or "user
  // picked an out-of-range week" (publish — surfaced as 400).
  private clampWindow(tt: Timetable, w: SeedWindow): SeedWindow | null {
    const ps = tt.programme_semester;
    const from =
      ps.planned_start_date && w.from < ps.planned_start_date
        ? ps.planned_start_date
        : w.from;
    const to =
      ps.planned_end_date && w.to > ps.planned_end_date
        ? ps.planned_end_date
        : w.to;
    if (to < from) return null;
    return { from, to };
  }

  // Expand one cell into the rows it would seed for a given date — one row
  // for a regular class, multiple for an elective cell (one per cohort).
  // Returns the cohort-resolved row shape ready for insert / preview.
  private async expandEntry(
    tx: EntityManager,
    tt: Timetable,
    entry: TimetableEntry,
    date: string,
    weekday: number,
    cohortCache: Map<number, CohortRow[]>,
  ): Promise<
    Array<{
      session_date: string;
      day_of_week: number;
      programme_semester_id: number;
      attendance_group_id: number | null;
      timetable_period_id: number;
      span: number;
      timetable_entry_id: number;
      programme_semester_subject_id: number;
      programme_semester_subject_option_id: number | null;
      slot_placeholder_name: string | null;
      subject_id: number;
      scheduled_employee_id: number;
      room: string | null;
    }>
  > {
    const pss = entry.programme_semester_subject;
    if (pss && pss.subject_id === null) {
      const cohorts = await this.getCohortsForSlot(
        tx,
        pss,
        tt.attendance_group_id,
        cohortCache,
      );
      return cohorts.map((c) => ({
        session_date: date,
        day_of_week: weekday,
        programme_semester_id: tt.programme_semester_id,
        attendance_group_id:
          pss.cohort_scope === 'programme_semester'
            ? null
            : tt.attendance_group_id,
        timetable_period_id: entry.timetable_period_id,
        span: entry.span,
        timetable_entry_id: entry.id,
        programme_semester_subject_id: pss.id,
        programme_semester_subject_option_id: c.option_id,
        // Slot identity — same for every cohort under this slot. The
        // preview UI uses this to collapse all cohorts under one row
        // labelled "Open Elective 1 — Dynamic allocation".
        slot_placeholder_name: pss.placeholder_name,
        subject_id: c.option_subject_id,
        scheduled_employee_id: c.employee_id,
        room: entry.room,
      }));
    }
    if (entry.employee_id === null) return [];
    const subjectId = pss?.subject_id ?? null;
    if (subjectId === null) {
      // Timetable-exclusive courses have no rollup subject yet — skip.
      this.logger.debug(
        `expandEntry: skip exclusive-course cell entry=${entry.id}`,
      );
      return [];
    }
    return [
      {
        session_date: date,
        day_of_week: weekday,
        programme_semester_id: tt.programme_semester_id,
        attendance_group_id: tt.attendance_group_id,
        timetable_period_id: entry.timetable_period_id,
        span: entry.span,
        timetable_entry_id: entry.id,
        programme_semester_subject_id: pss!.id,
        programme_semester_subject_option_id: null,
        slot_placeholder_name: null,
        subject_id: subjectId,
        scheduled_employee_id: entry.employee_id,
        room: entry.room,
      },
    ];
  }

  // Per (option, teacher) cohort discovery. For cross-group electives we
  // intentionally don't restrict by attendance_group_id so multiple groups
  // collapse onto the same cohort row. For per-group electives we filter
  // by the current timetable's group via student_groups.
  private async getCohortsForSlot(
    tx: EntityManager,
    slot: ProgrammeSemesterSubject,
    attendanceGroupId: number,
    cache: Map<number, CohortRow[]>,
  ): Promise<CohortRow[]> {
    const cacheKey =
      slot.cohort_scope === 'programme_semester'
        ? slot.id
        : slot.id + attendanceGroupId * 1_000_000_007;
    const hit = cache.get(cacheKey);
    if (hit) return hit;

    const qb = tx
      .createQueryBuilder()
      .from('programme_semester_subject_option_students', 'pos')
      .innerJoin(
        'programme_semester_subject_options',
        'pso',
        'pso.id = pos.programme_semester_subject_option_id',
      )
      .distinct(true)
      .select('pos.programme_semester_subject_option_id', 'option_id')
      .addSelect('pso.subject_id', 'option_subject_id')
      .addSelect('pos.employee_id', 'employee_id')
      .where('pos.programme_semester_subject_id = :slot_id', {
        slot_id: slot.id,
      });

    if (slot.cohort_scope === 'group') {
      qb.innerJoin(
        'student_groups',
        'sg',
        'sg.student_id = pos.student_id AND sg.attendance_group_id = :gid',
        { gid: attendanceGroupId },
      );
    }

    const rows = await qb.getRawMany<{
      option_id: number;
      option_subject_id: number;
      employee_id: number;
    }>();
    const cohorts: CohortRow[] = rows.map((r) => ({
      option_id: Number(r.option_id),
      option_subject_id: Number(r.option_subject_id),
      employee_id: Number(r.employee_id),
    }));
    cache.set(cacheKey, cohorts);
    return cohorts;
  }

  private async insertSession(
    tx: EntityManager,
    row: {
      session_date: string;
      day_of_week: number;
      programme_semester_id: number;
      attendance_group_id: number | null;
      timetable_period_id: number;
      span: number;
      timetable_entry_id: number;
      programme_semester_subject_id: number;
      programme_semester_subject_option_id: number | null;
      subject_id: number;
      scheduled_employee_id: number;
      room: string | null;
    },
  ): Promise<boolean> {
    const result = await tx.query(
      `INSERT INTO "class_sessions" (
         "session_date", "day_of_week", "programme_semester_id",
         "attendance_group_id", "timetable_period_id", "span",
         "timetable_entry_id", "programme_semester_subject_id",
         "programme_semester_subject_option_id", "subject_id",
         "scheduled_employee_id", "effective_employee_id",
         "status", "room"
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'scheduled',$12)
       ON CONFLICT (
         (COALESCE("attendance_group_id", 0)),
         "programme_semester_id",
         "session_date",
         "timetable_period_id",
         "programme_semester_subject_id",
         (COALESCE("programme_semester_subject_option_id", 0)),
         "scheduled_employee_id"
       ) DO NOTHING
       RETURNING id`,
      [
        row.session_date,
        row.day_of_week,
        row.programme_semester_id,
        row.attendance_group_id,
        row.timetable_period_id,
        row.span,
        row.timetable_entry_id,
        row.programme_semester_subject_id,
        row.programme_semester_subject_option_id,
        row.subject_id,
        row.scheduled_employee_id,
        row.room,
      ],
    );
    return Array.isArray(result) && result.length > 0;
  }

  // For preview: does a session matching the unique key already exist?
  private async sessionExists(
    tx: EntityManager,
    row: {
      attendance_group_id: number | null;
      programme_semester_id: number;
      session_date: string;
      timetable_period_id: number;
      programme_semester_subject_id: number;
      programme_semester_subject_option_id: number | null;
      scheduled_employee_id: number;
    },
  ): Promise<boolean> {
    const rs = await tx.query(
      `SELECT 1 FROM "class_sessions"
       WHERE COALESCE("attendance_group_id", 0) = COALESCE($1::int, 0)
         AND "programme_semester_id" = $2
         AND "session_date" = $3
         AND "timetable_period_id" = $4
         AND "programme_semester_subject_id" = $5
         AND COALESCE("programme_semester_subject_option_id", 0) = COALESCE($6::int, 0)
         AND "scheduled_employee_id" = $7
       LIMIT 1`,
      [
        row.attendance_group_id,
        row.programme_semester_id,
        row.session_date,
        row.timetable_period_id,
        row.programme_semester_subject_id,
        row.programme_semester_subject_option_id,
        row.scheduled_employee_id,
      ],
    );
    return Array.isArray(rs) && rs.length > 0;
  }

  private async loadEntries(
    tx: EntityManager,
    timetableId: number,
  ): Promise<TimetableEntry[]> {
    return tx
      .createQueryBuilder(TimetableEntry, 'e')
      .leftJoinAndSelect('e.programme_semester_subject', 'pss')
      .where('e.timetable_id = :id', { id: timetableId })
      .getMany();
  }

  private async loadApplicableHolidays(
    tx: EntityManager,
    tt: Timetable,
    fromStr: string,
    toStr: string,
  ): Promise<AcademicHoliday[]> {
    return tx
      .createQueryBuilder(AcademicHoliday, 'h')
      .where('h.date <= :to AND COALESCE(h.end_date, h.date) >= :from', {
        from: fromStr,
        to: toStr,
      })
      .andWhere(
        `(
          h.scope = 'institution'
          OR (h.scope = 'programme' AND h.programme_id = :pid)
          OR (h.scope = 'group' AND h.attendance_group_id = :gid)
        )`,
        {
          pid: tt.programme_semester.programme_id,
          gid: tt.attendance_group_id,
        },
      )
      .getMany();
  }

  private dateIsFullyBlocked(
    holidays: AcademicHoliday[],
    date: string,
  ): boolean {
    for (const h of holidays) {
      const end = h.end_date ?? h.date;
      if (date >= h.date && date <= end) return true;
    }
    return false;
  }
}

// --- helpers ----------------------------------------------------------------

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => Number(p));
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function enumerateDates(fromStr: string, toStr: string): string[] {
  const start = parseDate(fromStr);
  const end = parseDate(toStr);
  const out: string[] = [];
  for (
    let d = new Date(start.getTime());
    d.getTime() <= end.getTime();
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(formatDate(d));
  }
  return out;
}

function isoWeekday(dateStr: string): number {
  const d = parseDate(dateStr).getUTCDay();
  return d === 0 ? 7 : d;
}

function groupEntriesByDay(
  entries: TimetableEntry[],
  workingDays: Set<number>,
): Map<number, TimetableEntry[]> {
  const out = new Map<number, TimetableEntry[]>();
  for (const e of entries) {
    if (!workingDays.has(e.day_of_week)) continue;
    const bucket = out.get(e.day_of_week) ?? [];
    bucket.push(e);
    out.set(e.day_of_week, bucket);
  }
  return out;
}
