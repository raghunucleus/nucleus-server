import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { CompanyApprovalService } from './company-approval.service';
import { companyChromeFor } from './company-chrome';
import {
  chip,
  crRecordsFor,
  mapCrRecord,
  yearOption,
} from './cr-record-mapping';
import { CrViewService } from './cr-view.service';
import { CrViewListQueryDto } from './dto/cr-view.dto';
import { CompanyJobRole } from './entities/company-job-role.entity';
import { CompanyJobRoleYear } from './entities/company-job-role-year.entity';
import { CompanyJobRoleYearStatusLog } from './entities/company-job-role-year-status-log.entity';
import { PassoutYear } from './entities/passout-year.entity';

/** How many months of status-change history the trend line shows. */
const TREND_MONTHS = 12;

/** How many CRs the "most active" list names. */
const TOP_MOVERS = 10;

/** The CR chip — the employee accountable for a job role. */
export interface CrOption {
  id: number;
  emp_code: string;
  emp_display_name: string;
}

/** Raw shapes of the two `activity` aggregates — Postgres returns counts as text. */
interface MonthRow {
  month: string;
  changes: string;
  records: string;
}
interface MoverRow {
  id: number | null;
  emp_code: string | null;
  emp_display_name: string | null;
  changes: string;
}

export interface ManagementActivity {
  /** Exactly {@link TREND_MONTHS} entries, oldest first, zero-filled. */
  months: { month: string; changes: number; records: number }[];
  top_movers: { employee: CrOption | null; changes: number }[];
}

/**
 * Management View — every company job role for one passout year, across every
 * CR, plus the roll-ups management reads off it.
 *
 * The deliberate inverse of {@link CrViewService}: that surface hard-filters
 * `responsible_employee_id = <token employee>` on every query, this one filters
 * by nothing at all. Unscoped is the whole point — the screen exists to answer
 * "what is happening across all companies and all the people running them",
 * which no self-scoped list can show.
 *
 * READ-ONLY by construction, not by convention: there is no write method here
 * and no write handler on the controller, so the screen key it is guarded by has
 * nothing to mutate. Editing a record stays exclusively on CR View's `edit`
 * action, which cannot reach a role the caller does not own.
 *
 * Row payloads come from the shared {@link mapCrRecord} / {@link crRecordsFor}
 * rather than a private copy, so a Management View row is exactly a CR View row
 * plus `responsible_employee` — the client types it as a superset.
 */
@Injectable()
export class ManagementViewService {
  constructor(
    @InjectRepository(CompanyJobRole)
    private readonly jobRoles: Repository<CompanyJobRole>,
    @InjectRepository(CompanyJobRoleYear)
    private readonly records: Repository<CompanyJobRoleYear>,
    @InjectRepository(CompanyJobRoleYearStatusLog)
    private readonly statusLogs: Repository<CompanyJobRoleYearStatusLog>,
    @InjectRepository(PassoutYear)
    private readonly years: Repository<PassoutYear>,
    private readonly crView: CrViewService,
    private readonly approvals: CompanyApprovalService,
    private readonly storage: StorageService,
  ) {}

  /**
   * CR View's scope verbatim (years, default year, and every lookup picker),
   * plus the CR facet's options.
   *
   * Delegated rather than reimplemented: the year-resolution rules (overlapping
   * windows, CURRENT_DATE evaluated in Postgres) and the "serve our own lookups
   * because the master endpoints are guarded by another screen" argument apply
   * here identically, and two copies would drift.
   *
   * `crs` lists every employee who owns at least one job role — NOT only those
   * appearing in the current year's rows. A facet whose options depend on the
   * filtered set cannot be used to widen a filter.
   */
  async scope() {
    const [base, crs] = await Promise.all([
      this.crView.scope(),
      this.jobRoles
        .createQueryBuilder('r')
        .innerJoin('r.responsible_employee', 'e')
        .select('e.id', 'id')
        .addSelect('e.emp_code', 'emp_code')
        .addSelect('e.emp_display_name', 'emp_display_name')
        .distinct(true)
        .orderBy('e.emp_display_name', 'ASC')
        .getRawMany<CrOption>(),
    ]);
    return { ...base, crs };
  }

  /**
   * Every job role at every company, with whatever was recorded for the year.
   *
   * Unpaginated, exactly like CR View — and for the extra reason that the screen
   * derives its charts from the same in-memory rows the table filters, which is
   * what makes clicking a chart segment and the resulting filtered list agree by
   * construction rather than by two matching implementations.
   *
   * A role with no record for this year is NOT dropped: it comes back with
   * `record: null` (records materialize lazily), which is exactly the "nothing
   * recorded yet" management most wants to see.
   */
  async list(query: CrViewListQueryDto) {
    const year = await this.assertActiveYear(query.passout_year_id);

    const qb = this.jobRoles
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.company', 'c')
      .leftJoinAndSelect('c.categories', 'cat')
      // The CR — the one column CR View has no need to select, since there the
      // answer is always "you".
      .innerJoinAndSelect('r.responsible_employee', 'emp');

    if (query.search) {
      qb.andWhere(
        '(c.name ILIKE :s OR r.role_name ILIKE :s OR emp.emp_display_name ILIKE :s)',
        { s: `%${query.search}%` },
      );
    }

    const roles = await qb
      .orderBy('c.name', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .getMany();

    // A second query rather than a mapped join, same as CR View: `cat` already
    // multiplies the rows and TypeORM dedupes the entities.
    const records = await crRecordsFor(
      this.records,
      roles.map((r) => r.id),
      query.passout_year_id,
    );

    const chrome = await companyChromeFor(
      [...new Map(roles.map((r) => [r.company_id, r.company])).values()],
      this.storage,
      this.approvals,
    );

    return {
      passout_year: yearOption(year),
      items: roles.map((r) => ({
        job_role_id: r.id,
        role_name: r.role_name,
        responsible_employee: {
          id: r.responsible_employee.id,
          emp_code: r.responsible_employee.emp_code,
          emp_display_name: r.responsible_employee.emp_display_name,
        },
        company: {
          id: r.company.id,
          name: r.company.name,
          website: r.company.website,
          logo_url: chrome.get(r.company_id)?.logo_url ?? null,
          approval_status: r.company.approval_status,
          is_active: r.company.is_active,
          categories: (r.company.categories ?? []).map((x) => ({
            id: x.id,
            name: x.name,
          })),
          open_request: chrome.get(r.company_id)?.open_request ?? null,
        },
        record: mapCrRecord(records.get(r.id)),
      })),
    };
  }

  /**
   * The status transitions of one (role, year), newest first — the same viewer
   * CR View opens, minus the ownership guard. 404s only for a role that does not
   * exist or a year that is not active; "not yours" is not a condition here.
   */
  async statusHistory(jobRoleId: number, passoutYearId: number) {
    const role = await this.jobRoles.findOne({ where: { id: jobRoleId } });
    if (!role) throw new NotFoundException('Job role not found.');
    await this.assertActiveYear(passoutYearId);

    const record = await this.records.findOne({
      where: {
        company_job_role_id: jobRoleId,
        passout_year_id: passoutYearId,
      },
    });
    if (!record) return [];

    const rows = await this.statusLogs.find({
      where: { company_job_role_year_id: record.id },
      relations: { status: true, changed_by_employee: true },
      // The id tie-break keeps two same-timestamp changes in insert order.
      order: { created_at: 'DESC', id: 'DESC' },
    });
    return rows.map((log) => ({
      id: log.id,
      /** `null` = the status was cleared back to the default. */
      status: log.status ? chip(log.status) : null,
      changed_at: log.created_at,
      changed_by: log.changed_by_employee
        ? {
            id: log.changed_by_employee.id,
            name: log.changed_by_employee.emp_display_name,
          }
        : null,
    }));
  }

  /**
   * The only server-side aggregate on this screen: how much status movement the
   * year has seen, month by month, and who has been doing it.
   *
   * Every other insight is derived client-side from the list rows — that is both
   * free and self-consistent with the table's filters. This one cannot be: the
   * status log is history, and the list payload carries only each record's
   * CURRENT state.
   *
   * Raw SQL rather than the query builder for the same reason
   * `DriveAnalyticsService` uses it — `to_char` grouping and
   * `COUNT(DISTINCT …)` read far better as SQL than as builder calls. Postgres
   * returns COUNT as a string, hence the explicit `Number()`.
   */
  async activity(passoutYearId: number): Promise<ManagementActivity> {
    await this.assertActiveYear(passoutYearId);

    const [monthRows, moverRows] = await Promise.all([
      this.monthlyChanges(passoutYearId),
      this.topMovers(passoutYearId),
    ]);

    const byMonth = new Map(monthRows.map((r) => [r.month, r]));

    return {
      // Zero-filled so the line has no gaps — a month with no activity is
      // information, and recharts would otherwise just skip it.
      months: this.recentMonths().map((month) => {
        const hit = byMonth.get(month);
        return {
          month,
          changes: Number(hit?.changes ?? 0),
          records: Number(hit?.records ?? 0),
        };
      }),
      top_movers: moverRows.map((r) => ({
        // NULL when the acting employee was since deleted (the FK is SET NULL) —
        // the work still happened, so the row is kept and rendered as unknown.
        employee:
          r.id == null
            ? null
            : {
                id: r.id,
                emp_code: r.emp_code ?? '—',
                emp_display_name: r.emp_display_name ?? '—',
              },
        changes: Number(r.changes),
      })),
    };
  }

  /** Status transitions per calendar month, for the records of one year. */
  private async monthlyChanges(passoutYearId: number): Promise<MonthRow[]> {
    const rows: MonthRow[] = await this.statusLogs.query(
      `SELECT to_char(l."created_at", 'YYYY-MM') AS month,
              COUNT(*) AS changes,
              COUNT(DISTINCT l."company_job_role_year_id") AS records
         FROM "company_job_role_year_status_logs" l
         JOIN "company_job_role_years" y ON y."id" = l."company_job_role_year_id"
        WHERE y."passout_year_id" = $1
        GROUP BY 1
        ORDER BY 1`,
      [passoutYearId],
    );
    return rows;
  }

  /** Who moved the most records this year. */
  private async topMovers(passoutYearId: number): Promise<MoverRow[]> {
    const rows: MoverRow[] = await this.statusLogs.query(
      `SELECT e."id" AS id,
              e."emp_code" AS emp_code,
              e."emp_display_name" AS emp_display_name,
              COUNT(*) AS changes
         FROM "company_job_role_year_status_logs" l
         JOIN "company_job_role_years" y ON y."id" = l."company_job_role_year_id"
         LEFT JOIN "employees" e ON e."id" = l."changed_by_employee_id"
        WHERE y."passout_year_id" = $1
        GROUP BY e."id", e."emp_code", e."emp_display_name"
        ORDER BY changes DESC, e."emp_display_name" ASC
        LIMIT ${TOP_MOVERS}`,
      [passoutYearId],
    );
    return rows;
  }

  /** The last {@link TREND_MONTHS} months as 'YYYY-MM', oldest first. */
  private recentMonths(): string[] {
    const now = new Date();
    const out: string[] = [];
    for (let i = TREND_MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      );
    }
    return out;
  }

  /**
   * The year guard. Same as CR View's: the selector only offers active years, so
   * a request for a deactivated one is a stale client, not a valid query.
   */
  private async assertActiveYear(id: number): Promise<PassoutYear> {
    const year = await this.years.findOne({ where: { id, is_active: true } });
    if (!year) throw new NotFoundException('Passout year not found.');
    return year;
  }
}
