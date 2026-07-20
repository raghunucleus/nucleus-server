import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExportJobsService } from '../exports/export-jobs.service';
import {
  SearchCondition,
  SearchGroup,
  SearchNode,
  StudentSearchDto,
  StudentSearchResult,
} from '../../student-query/dto/student-search.dto';
import {
  exportFilename,
  rowsToCsv,
  rowsToXlsx,
} from '../../student-query/export';
import { StudentQueryService } from '../../student-query/student-query.service';
import { DrivesService } from './drives.service';
import { DriveStudentsService } from './drive-students.service';
import { Drive } from './entities/drive.entity';

/** Mirrors the engine's skip_pagination ceiling — checked up front so the
 *  caller gets an immediate 400 instead of a failed background job. */
const MAX_EXPORT_ROWS = 100_000;

/**
 * The drive detail page's "Filter" tab: the full registry-driven student
 * search, mounted under a drive so placement users can shortlist candidates.
 *
 * Gated by `drive_management.drives.manage` — which has NO per-attribute scope
 * (institution-wide, `attributes: []` in the catalog) — so the engine runs
 * WITHOUT an RBAC scope object, exactly like the admin surface but with the
 * employee attribute set (gov-ID fields excluded). This is deliberate: the
 * placement cell filters across the whole institution.
 *
 * Exports are ALWAYS async: the endpoint creates an export job and returns
 * immediately; the generic exports framework stores the file, notifies, and
 * expires it after 24h.
 */
@Injectable()
export class DriveStudentsSearchService {
  constructor(
    private readonly engine: StudentQueryService,
    private readonly jobs: ExportJobsService,
    private readonly drives: DrivesService,
    private readonly members: DriveStudentsService,
    @InjectRepository(Drive)
    private readonly driveRepo: Repository<Drive>,
  ) {}

  meta() {
    return this.engine.meta('employee');
  }

  options(lookup: string, q?: string) {
    return this.engine.fkOptions(lookup, q);
  }

  parseNql(nql: string) {
    return this.engine.parseNqlQuery(nql);
  }

  async search(
    driveId: number,
    dto: StudentSearchDto,
  ): Promise<StudentSearchResult> {
    if (dto.format !== 'json') {
      throw new BadRequestException(
        'File formats are not served inline. Use POST .../students/export to start an export job.',
      );
    }
    await this.assertDrive(driveId);
    const result = await this.engine.search(dto, { surface: 'employee' });

    // Annotate each row with drive membership so the Filter tab can badge and
    // disable students already imported. `in_drive` is NOT added to
    // `result.columns`, so the table never renders it as a column — it's
    // metadata the row-action reads off the row.
    const members = await this.members.memberIds(driveId);
    for (const row of result.rows) {
      row.in_drive = members.has(Number(row.id));
    }
    return result;
  }

  /**
   * The drive's eligibility criteria translated to filter conditions the tab
   * pre-fills (and the user may then freely edit). Server-side because the
   * registry keys, operator vocabulary and eligibility normalization all live
   * here — the client just renders a `SearchGroup`.
   */
  async prefill(driveId: number): Promise<{ filters: SearchGroup | null }> {
    const e = await this.drives.getEligibility(driveId);
    const conds: SearchNode[] = [];
    const cond = (attr: string, op: SearchCondition['op'], value: unknown) =>
      conds.push({ attr, op, value });

    if (e.programme_ids.length > 0) cond('programme', 'in', e.programme_ids);
    if (e.entry_types.length > 0) cond('entry_type', 'in', e.entry_types);
    if (e.genders.length > 0) cond('gender', 'in', e.genders);
    if (e.passout_years.length > 0)
      cond('pass_out_year', 'in', e.passout_years);
    // `true` means "backlog history allowed" = no restriction, so no condition.
    // Note the emitted conditions use plain SQL comparisons, so students with
    // NULL in these columns are excluded — correct for eligibility screening;
    // the user can delete the row if they want the looser reading.
    if (!e.allow_backlog_history) cond('backlog_history', 'eq', false);
    if (e.max_current_backlogs !== null)
      cond('current_backlogs', 'lte', e.max_current_backlogs);
    if (e.min_tenth_percentage !== null)
      cond('tenth_percentage', 'gte', e.min_tenth_percentage);
    // 12th and Diploma are independent thresholds, each screening only its own
    // cohort: regular entrants (1) carry a 12th percentage, lateral entrants (2)
    // a diploma one. Written as "not that cohort, OR clears its bar" rather than
    // the equivalent "(regular AND 12th >= X) OR (lateral AND diploma >= Y)" —
    // the Filters builder models a row as a single-level OR of plain conditions
    // (see the client's `decomposeFilters`), so a group nested inside an OR
    // would make it discard the whole prefill. This form also leaves each cohort
    // rule as its own editable row.
    // (`entry_type != 1` is NULL-false, so a student with no entry type would
    // have to clear both bars — same NULL caveat as the thresholds above.)
    if (e.min_twelfth_percentage !== null) {
      conds.push({
        or: [
          { attr: 'entry_type', op: 'neq', value: 1 },
          {
            attr: 'twelfth_percentage',
            op: 'gte',
            value: e.min_twelfth_percentage,
          },
        ],
      });
    }
    if (e.min_diploma_percentage !== null) {
      conds.push({
        or: [
          { attr: 'entry_type', op: 'neq', value: 2 },
          {
            attr: 'diploma_percentage',
            op: 'gte',
            value: e.min_diploma_percentage,
          },
        ],
      });
    }
    if (e.min_btech_cgpa !== null) cond('ug_cgpa', 'gte', e.min_btech_cgpa);

    return { filters: conds.length > 0 ? { and: conds } : null };
  }

  async export(
    employeeId: number,
    driveId: number,
    dto: StudentSearchDto,
  ): Promise<{ job_id: number }> {
    if (dto.format !== 'csv' && dto.format !== 'xlsx') {
      throw new BadRequestException(
        'Export requires "format" to be "csv" or "xlsx".',
      );
    }
    const format = dto.format;
    const drive = await this.assertDrive(driveId);

    // Synchronous 1-row probe: re-validates filters/columns (bad input fails
    // the request, not a background job) and bounds the result set up front.
    const probe = await this.engine.search(
      { ...dto, skip_pagination: false, page: 1, pageSize: 1, format: 'json' },
      { surface: 'employee' },
    );
    if (probe.total > MAX_EXPORT_ROWS) {
      throw new BadRequestException(
        `Result set too large to export (${probe.total} rows, max ${MAX_EXPORT_ROWS.toLocaleString('en-US')}). Narrow the filters.`,
      );
    }

    // The closure snapshots everything it needs — a drive deleted mid-job
    // doesn't break the export.
    const searchDto = {
      ...dto,
      skip_pagination: true,
      page: 1,
      format: 'json' as const,
    };
    return this.jobs
      .create({
        employeeId,
        source: 'drive_students',
        label: `Students — ${drive.drive_name}`,
        context: { drive_id: driveId },
        format,
        filename: exportFilename(format),
        generate: async () => {
          const result = await this.engine.search(searchDto, {
            surface: 'employee',
          });
          const buffer =
            format === 'csv'
              ? rowsToCsv(result.columns, result.rows)
              : await rowsToXlsx(result.columns, result.rows);
          return { buffer, rowCount: result.total };
        },
      })
      .then(({ id }) => ({ job_id: id }));
  }

  private async assertDrive(driveId: number): Promise<Drive> {
    const drive = await this.driveRepo.findOne({ where: { id: driveId } });
    if (!drive) throw new NotFoundException('Drive not found.');
    return drive;
  }
}
