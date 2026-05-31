import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AcademicHoliday,
  AcademicHolidayType,
} from '../admin/entities/academic-holiday.entity';

// The read-only projection of a holiday handed to students and employees.
// Internal columns (declarer ids, timestamps) are deliberately dropped — the
// consumer only needs to render a calendar entry.
export interface PublicHoliday {
  id: number;
  date: string;
  end_date: string | null;
  name: string;
  type: AcademicHolidayType;
  reason: string | null;
}

// Time-relative slice of the calendar, evaluated against the DB's CURRENT_DATE
// so "today" is the server's clock, not the client's:
//   'upcoming' — holidays still to come (or in progress today)
//   'past'     — holidays whose last day is already behind us
export type HolidayScope = 'upcoming' | 'past';

interface RangeOpts {
  from?: string;
  to?: string;
  scope?: HolidayScope;
}

interface PageOpts extends RangeOpts {
  page?: number;
  page_size?: number;
}

// A single page of holidays, with enough metadata for the client to drive
// prev/next controls without re-deriving counts.
export interface PaginatedHolidays {
  items: PublicHoliday[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Shared, role-agnostic read layer for declared holidays. Lives in its own
 * tiny module so the student and employee modules can surface the academic
 * calendar without importing the entire admin module (and the dependency
 * tangle that would bring). All writes still go through the admin/employee
 * HolidaysService — this service never mutates.
 */
@Injectable()
export class HolidaysReadService {
  constructor(
    @InjectRepository(AcademicHoliday)
    private readonly holidays: Repository<AcademicHoliday>,
  ) {}

  /**
   * The institution calendar a student sees. Holidays are always
   * institution-wide, so every student sees the same list — but the signature
   * still takes the student id (sourced from the JWT, never a route param) so
   * the student-API isolation contract is explicit at the call site.
   */
  async listForStudent(
    _studentId: number,
    opts: RangeOpts = {},
  ): Promise<PublicHoliday[]> {
    return this.project(await this.baseRangeQuery(opts).getMany());
  }

  /**
   * Same calendar as {@link listForStudent}, but page-windowed for the student
   * web/mobile holiday browser. `total` is the count across the whole filtered
   * range so the client can render "page X of Y" without a second request.
   * Pages are 1-based; ordering stays `date ASC` so a page boundary is stable
   * as long as the filter window is unchanged.
   */
  async listForStudentPaged(
    _studentId: number,
    opts: PageOpts = {},
  ): Promise<PaginatedHolidays> {
    const page = Math.max(1, Math.trunc(opts.page ?? 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(opts.page_size ?? DEFAULT_PAGE_SIZE)),
    );

    const [rows, total] = await this.baseRangeQuery(opts)
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: this.project(rows),
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
    };
  }

  /**
   * The full institution calendar for an employee — identical to the student
   * calendar now that holidays carry no scope.
   */
  async listForEmployee(opts: RangeOpts = {}): Promise<PublicHoliday[]> {
    return this.project(await this.baseRangeQuery(opts).getMany());
  }

  /**
   * Page-windowed employee calendar — same data as {@link listForEmployee},
   * for the employee holiday browser with year/month/range filters. Mirrors
   * {@link listForStudentPaged}; the calendar is institution-wide so there is
   * no per-employee scoping.
   */
  async listForEmployeePaged(opts: PageOpts = {}): Promise<PaginatedHolidays> {
    const page = Math.max(1, Math.trunc(opts.page ?? 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Math.trunc(opts.page_size ?? DEFAULT_PAGE_SIZE)),
    );

    const [rows, total] = await this.baseRangeQuery(opts)
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items: this.project(rows),
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
    };
  }

  private baseRangeQuery(opts: RangeOpts) {
    // Past holidays read most-recent-first (you scroll back in time); upcoming
    // and unscoped lists read soonest-first.
    const qb = this.holidays
      .createQueryBuilder('h')
      .orderBy('h.date', opts.scope === 'past' ? 'DESC' : 'ASC');
    // A range is matched if the holiday overlaps [from, to] at all — a
    // multi-day break that starts before `from` but extends into the window
    // still applies.
    if (opts.from) {
      qb.andWhere('COALESCE(h.end_date, h.date) >= :from', { from: opts.from });
    }
    if (opts.to) {
      qb.andWhere('h.date <= :to', { to: opts.to });
    }
    // A holiday is "done" only once its final day is strictly before today, so
    // a break in progress today counts as upcoming, not past.
    if (opts.scope === 'upcoming') {
      qb.andWhere('COALESCE(h.end_date, h.date) >= CURRENT_DATE');
    } else if (opts.scope === 'past') {
      qb.andWhere('COALESCE(h.end_date, h.date) < CURRENT_DATE');
    }
    return qb;
  }

  private project(rows: AcademicHoliday[]): PublicHoliday[] {
    return rows.map((h) => ({
      id: h.id,
      date: h.date,
      end_date: h.end_date,
      name: h.name,
      type: h.type,
      reason: h.reason,
    }));
  }
}
