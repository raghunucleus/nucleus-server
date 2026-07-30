import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  EntityTarget,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { Programme } from '../../admin/entities/programme.entity';
import { StorageService } from '../../storage/storage.service';
import {
  DriveDesignation,
  DriveJobLocation,
} from '../drive-management/entities/drive-lookups.entity';
import { CompanyApprovalService } from './company-approval.service';
import { companyChromeFor } from './company-chrome';
import {
  chip,
  crRecordsFor,
  mapCrRecord,
  yearOption,
  type LookupRow,
} from './cr-record-mapping';
import { CrViewListQueryDto, UpsertCrViewRecordDto } from './dto/cr-view.dto';
import { CompanyJobRole } from './entities/company-job-role.entity';
import { CompanyJobRoleYear } from './entities/company-job-role-year.entity';
import { CompanyJobRoleYearContact } from './entities/company-job-role-year-contact.entity';
import { CompanyJobRoleYearStatusLog } from './entities/company-job-role-year-status-log.entity';
import {
  CompanyCurrentStatus,
  CompanyRelationshipType,
} from './entities/company-lookups.entity';
import { PassoutYear } from './entities/passout-year.entity';

/** Postgres `unique_violation` — the upsert's only expected race. */
const UNIQUE_VIOLATION = '23505';

/**
 * CR View — the caller's own job roles, per passout year.
 *
 * Deliberately separate from {@link CorporateRelationsService}, which is the
 * company row and its approval choreography (`createCompany` / `updateCompany` /
 * `setLogo` / `writeRoles` all route through {@link CompanyApprovalService}).
 * CR View has no approval flow at all; folding it in would put two unrelated
 * lifecycles behind one class and hand this screen's controller a dependency on
 * the company-write surface it must never reach.
 *
 * Self-scoped exactly like Roles or Designations: every query filters on
 * `responsible_employee_id = <token employee>`, which is never a parameter. The
 * passout year IS a parameter, but it is validated against the active master —
 * which years exist is institution config, not a per-caller grant.
 */
@Injectable()
export class CrViewService {
  constructor(
    @InjectRepository(CompanyJobRole)
    private readonly jobRoles: Repository<CompanyJobRole>,
    @InjectRepository(CompanyJobRoleYear)
    private readonly records: Repository<CompanyJobRoleYear>,
    @InjectRepository(CompanyJobRoleYearStatusLog)
    private readonly statusLogs: Repository<CompanyJobRoleYearStatusLog>,
    @InjectRepository(PassoutYear)
    private readonly years: Repository<PassoutYear>,
    @InjectRepository(CompanyRelationshipType)
    private readonly relationshipTypes: Repository<CompanyRelationshipType>,
    @InjectRepository(CompanyCurrentStatus)
    private readonly statuses: Repository<CompanyCurrentStatus>,
    @InjectRepository(DriveDesignation)
    private readonly designations: Repository<DriveDesignation>,
    @InjectRepository(DriveJobLocation)
    private readonly jobLocations: Repository<DriveJobLocation>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    private readonly approvals: CompanyApprovalService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Everything the screen needs before it can render a row: the years, which
   * one to open on, and the two pickers with the fallback status.
   *
   * Exists so the page never has to call the Company Attributes endpoints,
   * which are guarded by that screen's key — a CR-View-only holder would 403 on
   * every one of them. That argument covers the lookups exactly as it covers
   * the years.
   *
   * The default is the year currently in progress, falling back to the nearest
   * upcoming one and then to the latest.
   *
   * Windows OVERLAP by default — the master seeds each year as
   * `(year-1)-01-01 .. year-12-31`, so any given day sits inside two of them
   * (July 2026 is in both 2025-2026 and 2026-2027). `ORDER BY passout_year ASC`
   * breaks that tie towards the batch graduating soonest, which is the one a
   * desk is closing out. Whoever wants the later batch switches once and the
   * screen remembers it.
   *
   * The "contains today" test is done by Postgres: `new Date().toISOString()`
   * is UTC, which reads as YESTERDAY between 00:00 and 05:30 IST — a real
   * off-by-one on exactly the boundary days where this matters.
   */
  async scope() {
    const [
      rows,
      relationship_types,
      current_statuses,
      default_status,
      designations,
      programmes,
      job_locations,
    ] = await Promise.all([
      this.years.find({
        where: { is_active: true },
        order: { passout_year: 'DESC' },
      }),
      this.activeLookups(this.relationshipTypes),
      this.activeLookups(this.statuses),
      this.defaultStatus(),
      // The Drive Attributes and academics masters, served from HERE for the
      // same reason as the Company Attributes lookups: their own endpoints are
      // guarded by screens a CR-View-only holder does not have.
      this.activeLookups(this.designations),
      this.programmeOptions(),
      this.activeLookups(this.jobLocations),
    ]);
    if (rows.length === 0) {
      return {
        years: [],
        default_year_id: null,
        relationship_types,
        current_statuses,
        default_status,
        designations,
        programmes,
        job_locations,
      };
    }

    const [current]: { id: number }[] = await this.years.query(
      `SELECT "id" FROM "passout_years"
        WHERE "is_active" = true AND CURRENT_DATE BETWEEN "start_date" AND "end_date"
        ORDER BY "passout_year" ASC LIMIT 1`,
    );

    // 'YYYY-MM-DD' sorts lexicographically, so string compares are enough —
    // the same trick `PassoutYearsService.assertDateOrder` relies on.
    const [today]: { d: string }[] = await this.years.query(
      `SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`,
    );
    const upcoming = rows
      .filter((y) => y.start_date > today.d)
      .sort((a, b) => a.passout_year - b.passout_year)[0];

    return {
      years: rows.map(yearOption),
      default_year_id: current?.id ?? upcoming?.id ?? rows[0].id,
      relationship_types,
      current_statuses,
      // DISPLAY ONLY, and resolved here rather than per row: a record with no
      // status renders this instead, so the two strings ship once per page
      // load rather than repeating on every row — and `record: null` keeps
      // meaning "nothing recorded yet", which the Updated column and the
      // updated_at sort both depend on.
      default_status,
      designations,
      programmes,
      job_locations,
    };
  }

  /** A lookup master's active values, in the order the screen shows them. */
  private activeLookups(repo: Repository<LookupRow>) {
    return repo
      .find({
        where: { is_active: true },
        order: { sort_order: 'ASC', name: 'ASC' },
      })
      .then((rows) => rows.map(chip));
  }

  /**
   * Active programmes as picker chips. Unlike the lookup masters, `programmes`
   * has no `sort_order`, so name order is the order; and the picker name is
   * `display_name` falling back to the long `name` — the same resolution as
   * the drives eligibility options.
   */
  private programmeOptions() {
    return this.programmes
      .find({ where: { is_active: true }, loadEagerRelations: false })
      .then((rows) =>
        rows
          .map((p) => ({ id: p.id, name: p.display_name || p.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
  }

  /**
   * The status a (role, year) shows before anything is recorded. `null` only
   * when an admin has deactivated the flagged row out from under the flag,
   * which `setStatus` refuses — the screen still handles it as an em-dash.
   */
  private async defaultStatus() {
    const row = await this.statuses.findOne({
      where: { is_default: true, is_active: true },
    });
    return row ? chip(row) : null;
  }

  /**
   * Every job role the caller is accountable for, with whatever was recorded
   * for the selected year.
   *
   * Unpaginated, same shape and doctrine as `listMyJobRoles`. A role with no
   * record for this year is NOT filtered out — it comes back with
   * `record: null`, which is what "nothing recorded yet" renders from. That is
   * the whole point of materializing lazily.
   */
  async list(employeeId: number, query: CrViewListQueryDto) {
    const year = await this.assertActiveYear(query.passout_year_id);

    const qb = this.jobRoles
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.company', 'c')
      .leftJoinAndSelect('c.categories', 'cat')
      .where('r.responsible_employee_id = :me', { me: employeeId });

    if (query.search) {
      qb.andWhere('(c.name ILIKE :s OR r.role_name ILIKE :s)', {
        s: `%${query.search}%`,
      });
    }

    const roles = await qb
      .orderBy('c.name', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .getMany();

    // A second query rather than a mapped join: `cat` already multiplies the
    // rows and TypeORM dedupes the entities, so stacking a mapped join on top
    // is a subtlety with no payoff. Bounded by the caller's own role count.
    const records = await this.recordsFor(
      roles.map((r) => r.id),
      query.passout_year_id,
    );

    const chrome = await companyChromeFor(
      [...new Map(roles.map((r) => [r.company_id, r.company])).values()],
      this.storage,
      this.approvals,
    );

    return {
      // Echoed so the client can confirm the server agreed with the year it
      // asked for, rather than trusting its own selector state.
      passout_year: yearOption(year),
      items: roles.map((r) => ({
        job_role_id: r.id,
        role_name: r.role_name,
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

  /** One row — what an editor loads before saving. */
  async getRow(employeeId: number, jobRoleId: number, passoutYearId: number) {
    const role = await this.assertOwnedRole(jobRoleId, employeeId);
    const year = await this.assertActiveYear(passoutYearId);

    const company = role.company;
    const chrome = await companyChromeFor(
      [company],
      this.storage,
      this.approvals,
    );
    const records = await this.recordsFor([role.id], passoutYearId);

    return {
      passout_year: yearOption(year),
      job_role_id: role.id,
      role_name: role.role_name,
      company: {
        id: company.id,
        name: company.name,
        website: company.website,
        logo_url: chrome.get(company.id)?.logo_url ?? null,
        approval_status: company.approval_status,
        is_active: company.is_active,
        categories: (company.categories ?? []).map((x) => ({
          id: x.id,
          name: x.name,
        })),
        open_request: chrome.get(company.id)?.open_request ?? null,
      },
      record: mapCrRecord(records.get(role.id)),
    };
  }

  /**
   * The status transitions of one (role, year), newest first. Same guards as
   * every read here; a role with no record for the year simply has no history.
   */
  async statusHistory(
    employeeId: number,
    jobRoleId: number,
    passoutYearId: number,
  ) {
    await this.assertOwnedRole(jobRoleId, employeeId);
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
   * Save the record for one (role, year), creating it if this is the first save.
   *
   * Read-then-save rather than `repo.upsert()` / `orUpdate`: TypeORM's conflict
   * target takes column names rather than the constraint, and its
   * `ON CONFLICT DO UPDATE` path skips `@UpdateDateColumn`, which would leave
   * `updated_at` stale unless the SET list hand-writes `now()`. Keeping the
   * audit columns honest is worth the extra read.
   */
  async upsert(
    employeeId: number,
    jobRoleId: number,
    passoutYearId: number,
    dto: UpsertCrViewRecordDto,
  ) {
    await this.assertOwnedRole(jobRoleId, employeeId);
    const year = await this.assertActiveYear(passoutYearId);

    try {
      await this.writeRecord(employeeId, jobRoleId, year, dto);
    } catch (e) {
      // Two concurrent saves on the same pair both miss the read and both
      // insert; one loses on the unique constraint. Retrying once is enough —
      // the retry's read now finds the row and takes the update path.
      if (!this.isUniqueViolation(e)) throw e;
      await this.writeRecord(employeeId, jobRoleId, year, dto);
    }

    return this.getRow(employeeId, jobRoleId, passoutYearId);
  }

  private writeRecord(
    employeeId: number,
    jobRoleId: number,
    year: PassoutYear,
    dto: UpsertCrViewRecordDto,
  ): Promise<void> {
    const passoutYearId = year.id;
    return this.records.manager.transaction(async (m) => {
      let row = await m.findOne(CompanyJobRoleYear, {
        where: {
          company_job_role_id: jobRoleId,
          passout_year_id: passoutYearId,
        },
        // Loaded so `save` can diff the junction rows. Assigning the array on
        // an entity whose relation was never loaded reads as "added
        // everything" to TypeORM, which would duplicate-key on re-save.
        // Every M:N this method may assign must be listed here.
        relations: {
          relationship_types: true,
          designations: true,
          programmes: true,
          job_locations: true,
        },
      });
      if (!row) {
        row = m.create(CompanyJobRoleYear, {
          company_job_role_id: jobRoleId,
          passout_year_id: passoutYearId,
          created_by_employee_id: employeeId,
          relationship_types: [],
          designations: [],
          programmes: [],
          job_locations: [],
        });
      }

      // Applied key by key rather than spread: `relationship_types` is a
      // relation, not a column, so the ids in the DTO are not what the entity
      // holds. An absent key means "leave this field alone" (PATCH semantics).
      //
      // `statusChanged` is decided against the row's CURRENT value before the
      // assignment: the full-edit sheet always sends `current_status_id`, and
      // a no-op save must not spam the history log.
      let statusChanged = false;
      if (dto.current_status_id !== undefined) {
        await this.assertSelectable(
          m,
          CompanyCurrentStatus,
          dto.current_status_id === null ? [] : [dto.current_status_id],
          row.current_status_id === null ? [] : [row.current_status_id],
          'current status',
        );
        statusChanged =
          dto.current_status_id !== (row.current_status_id ?? null);
        row.current_status_id = dto.current_status_id;
      }

      if (dto.relationship_type_ids !== undefined) {
        const ids = [...new Set(dto.relationship_type_ids)];
        await this.assertSelectable(
          m,
          CompanyRelationshipType,
          ids,
          (row.relationship_types ?? []).map((t) => t.id),
          'relationship type',
        );
        // Id-only partials: the lookup rows already exist and must not be
        // written through this relation. Same shape as
        // `CompanyApprovalService.applyCategories`.
        row.relationship_types = ids.map((id) => ({
          id,
        })) as CompanyRelationshipType[];
      }

      if (dto.designation_ids !== undefined) {
        const ids = [...new Set(dto.designation_ids)];
        await this.assertSelectable(
          m,
          DriveDesignation,
          ids,
          (row.designations ?? []).map((d) => d.id),
          'designation',
        );
        row.designations = ids.map((id) => ({ id })) as DriveDesignation[];
      }

      if (dto.programme_ids !== undefined) {
        const ids = [...new Set(dto.programme_ids)];
        await this.assertSelectable(
          m,
          Programme,
          ids,
          (row.programmes ?? []).map((p) => p.id),
          'programme',
        );
        row.programmes = ids.map((id) => ({ id })) as Programme[];
      }

      if (dto.job_location_ids !== undefined) {
        const ids = [...new Set(dto.job_location_ids)];
        await this.assertSelectable(
          m,
          DriveJobLocation,
          ids,
          (row.job_locations ?? []).map((l) => l.id),
          'job location',
        );
        row.job_locations = ids.map((id) => ({ id })) as DriveJobLocation[];
      }

      if (dto.next_follow_up_date !== undefined) {
        row.next_follow_up_date = dto.next_follow_up_date;
      }

      if (dto.remarks !== undefined) {
        row.remarks = dto.remarks;
      }

      row.updated_by_employee_id = employeeId;
      await m.save(row);

      // Stamp the reference code once, on first save — the id exists only
      // now. `CR-<passout year>-<id padded to 5>`: unique by construction
      // (the number IS the primary key) and never touched again, because a
      // reference key that other modules quote must survive renames.
      if (row.record_code == null) {
        row.record_code =
          `CR-${year.passout_year}-` + String(row.id).padStart(5, '0');
        await m.save(row);
      }

      // AFTER the save (a first-save record has no id until here), INSIDE the
      // transaction: a rolled-back save logs nothing, and the unique-violation
      // retry cannot double-log because the first attempt rolled back whole.
      if (statusChanged) {
        await m.save(
          m.create(CompanyJobRoleYearStatusLog, {
            company_job_role_year_id: row.id,
            status_id: dto.current_status_id ?? null,
            changed_by_employee_id: employeeId,
          }),
        );
      }

      // AFTER the save: a first-save record has no id to hang contacts off
      // until here. `contacts`, when present, is the complete desired set —
      // delete what's absent, update by id, insert the rest, same reconcile
      // as a drive's profiles.
      if (dto.contacts !== undefined) {
        const stored = await m.find(CompanyJobRoleYearContact, {
          where: { company_job_role_year_id: row.id },
        });
        const keepIds = dto.contacts
          .map((c) => c.id)
          .filter((v): v is number => v != null);
        const doomed = stored.filter((s) => !keepIds.includes(s.id));
        if (doomed.length > 0) {
          await m.delete(CompanyJobRoleYearContact, {
            id: In(doomed.map((d) => d.id)),
          });
        }
        for (const [i, c] of dto.contacts.entries()) {
          let contact: CompanyJobRoleYearContact;
          if (c.id != null) {
            // Re-check the echoed id belongs to THIS record — a 400, not a
            // silent re-parent of somebody else's contact row.
            const found = stored.find((s) => s.id === c.id);
            if (!found) {
              throw new BadRequestException(
                `Contact ${i + 1} doesn't belong to this record.`,
              );
            }
            contact = found;
          } else {
            contact = m.create(CompanyJobRoleYearContact, {
              company_job_role_year_id: row.id,
            });
          }
          contact.hr_name = c.hr_name;
          contact.hr_designation = c.hr_designation ?? null;
          contact.hr_mobile = c.hr_mobile ?? null;
          contact.hr_landline = c.hr_landline ?? null;
          contact.hr_email = c.hr_email ?? null;
          contact.sort_order = c.sort_order ?? i;
          await m.save(contact);
        }
      }
    });
  }

  /**
   * A referenced lookup must exist, and must be ACTIVE unless this record
   * already holds it.
   *
   * The exception is the point: deactivating a value must not make every record
   * that already carries it unsaveable. You can keep it or drop it — you just
   * cannot newly add it.
   *
   * Runs inside the write transaction because it needs the row's current ids
   * anyway. A `BadRequestException` here simply rolls back; `upsert`'s retry
   * only catches `23505`, so this never loops.
   */
  private async assertSelectable(
    m: EntityManager,
    entity: EntityTarget<Pick<LookupRow, 'id' | 'name' | 'is_active'>>,
    ids: number[],
    kept: number[],
    label: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows = await m.find(entity, { where: { id: In(ids) } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) {
        throw new BadRequestException(`Unknown ${label}.`);
      }
      if (!row.is_active && !kept.includes(id)) {
        throw new BadRequestException(
          `"${row.name}" is no longer available as a ${label}.`,
        );
      }
    }
  }

  /**
   * The ownership guard. 404s rather than 403s: a 403 would confirm that job
   * role id 812 exists and belongs to somebody else, which is exactly the probe
   * `assertCompanyVisibleToOwner` refuses to answer. Both conditions are one
   * `AND` in the same lookup, so "does not exist" and "is not yours" are
   * indistinguishable by construction.
   */
  private async assertOwnedRole(
    jobRoleId: number,
    employeeId: number,
  ): Promise<CompanyJobRole> {
    const role = await this.jobRoles.findOne({
      where: { id: jobRoleId, responsible_employee_id: employeeId },
      relations: { company: { categories: true } },
    });
    if (!role) throw new NotFoundException('Job role not found.');
    return role;
  }

  /**
   * Guards both the list and the upsert. Writing against a deactivated year
   * would create a record the screen can never show again, since the selector
   * only offers active years.
   */
  private async assertActiveYear(id: number): Promise<PassoutYear> {
    const year = await this.years.findOne({ where: { id, is_active: true } });
    if (!year) throw new NotFoundException('Passout year not found.');
    return year;
  }

  /**
   * Thin wrapper over the shared {@link crRecordsFor} — Management View calls
   * the same helper with its own (unscoped) role id set, so the mapping stays
   * one implementation.
   */
  private recordsFor(
    jobRoleIds: number[],
    passoutYearId: number,
  ): Promise<Map<number, CompanyJobRoleYear>> {
    return crRecordsFor(this.records, jobRoleIds, passoutYearId);
  }

  private isUniqueViolation(e: unknown): boolean {
    return (
      e instanceof QueryFailedError &&
      (e.driverError as { code?: string } | undefined)?.code ===
        UNIQUE_VIOLATION
    );
  }
}
