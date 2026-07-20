import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';
import {
  StudentSearchDto,
  StudentSearchResult,
} from '../../student-query/dto/student-search.dto';
import {
  exportFilename,
  rowsToCsv,
  rowsToXlsx,
} from '../../student-query/export';
import {
  StudentQueryOptions,
  StudentQueryService,
} from '../../student-query/student-query.service';
import { ExportJobsService } from '../exports/export-jobs.service';
import {
  CoordinatorBatch,
  PlacementCoordinatorStudentsService,
} from './placement-coordinator-students.service';

/** Mirrors the engine's skip_pagination ceiling — checked up front so the
 *  caller gets an immediate 400 instead of a failed background job. */
const MAX_EXPORT_ROWS = 100_000;

/**
 * The registry-driven student search for the Placement Coordinator's Students
 * tab — the same engine the drive Filter tab and Eligibility check use, scoped
 * to one of the coordinator's verified batches.
 *
 * The batch maps exactly onto two of the engine's four scope axes, and engine
 * scope predicates are applied BEFORE the user's filters and cannot be
 * overridden. That is the real boundary: the UI hides the programme /
 * department / pass-out-year attributes only because the batch already pins
 * them, so a hand-written NQL filter on those can narrow the result but can
 * never reach another batch's students.
 *
 * Every entry point resolves the batch through
 * `PlacementCoordinatorStudentsService.assertBatch` first, which 404s on a
 * batch this employee does not verify.
 */
@Injectable()
export class PlacementCoordinatorStudentsSearchService {
  constructor(
    private readonly engine: StudentQueryService,
    private readonly jobs: ExportJobsService,
    private readonly coordinator: PlacementCoordinatorStudentsService,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
  ) {}

  /** Batch-independent: the attribute registry is the same for every batch. */
  meta() {
    return this.engine.meta('employee');
  }

  options(lookup: string, q?: string) {
    return this.engine.fkOptions(lookup, q);
  }

  parseNql(nql: string) {
    return this.engine.parseNqlQuery(nql);
  }

  /**
   * The engine options for one verified batch, optionally narrowed to the
   * allowed / not-allowed bucket the toolbar switch selected.
   */
  private scopeFor(
    batch: CoordinatorBatch,
    allowed?: boolean,
  ): StudentQueryOptions {
    return {
      surface: 'employee',
      scope: {
        programmeIds: [batch.programme_id],
        admissionYearIds: [batch.admission_year_id],
        placementAllowed: allowed,
      },
    };
  }

  async search(
    employeeId: number,
    payId: number,
    dto: StudentSearchDto,
    allowed?: boolean,
  ): Promise<StudentSearchResult> {
    if (dto.format !== 'json') {
      throw new BadRequestException(
        'File formats are not served inline. Use POST .../students/export to start an export job.',
      );
    }
    const batch = await this.coordinator.assertBatch(employeeId, payId);
    const result = await this.engine.search(dto, this.scopeFor(batch, allowed));
    return { ...result, rows: await this.hydrate(result.rows) };
  }

  /**
   * Attach the two facts the results table's row action needs but the engine
   * cannot supply: the authoritative placement flag (independent of whether
   * the user selected that column) and profile completion (computed in JS from
   * the field registry, not derivable in SQL).
   *
   * Underscore-prefixed so they can never collide with a registry attribute
   * key. `ResultsTable` renders `result.columns` only, so these stay invisible
   * to it and are read by the row-action renderer.
   */
  private async hydrate(
    rows: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    const ids = rows
      .map((r) => Number(r.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return rows;

    const students = await this.students.find({ where: { id: In(ids) } });
    const byId = new Map(
      students.map((s) => [s.id, this.coordinator.rowView(s)]),
    );

    return rows.map((r) => {
      const view = byId.get(Number(r.id));
      if (!view) return r;
      return {
        ...r,
        _allowed: view.allowed_by_dept_for_placements,
        _interested: view.interested_in_placements_self,
        _completion: view.completion,
      };
    });
  }

  async export(
    employeeId: number,
    payId: number,
    dto: StudentSearchDto,
    allowed?: boolean,
  ): Promise<{ job_id: number }> {
    if (dto.format !== 'csv' && dto.format !== 'xlsx') {
      throw new BadRequestException(
        'Export requires "format" to be "csv" or "xlsx".',
      );
    }
    const format = dto.format;
    const batch = await this.coordinator.assertBatch(employeeId, payId);
    // The probe and the job share these options, so the export matches exactly
    // what the screen was showing when the user asked for it.
    const options = this.scopeFor(batch, allowed);

    // Synchronous 1-row probe: re-validates filters/columns (bad input fails
    // the request, not a background job) and bounds the result set up front.
    const probe = await this.engine.search(
      { ...dto, skip_pagination: false, page: 1, pageSize: 1, format: 'json' },
      options,
    );
    if (probe.total > MAX_EXPORT_ROWS) {
      throw new BadRequestException(
        `Result set too large to export (${probe.total} rows, max ${MAX_EXPORT_ROWS.toLocaleString('en-US')}). Narrow the filters.`,
      );
    }

    const searchDto = {
      ...dto,
      skip_pagination: true,
      page: 1,
      format: 'json' as const,
    };
    return this.jobs
      .create({
        employeeId,
        source: 'placement_coordinator_students',
        label: `Placement readiness — ${batch.label}`,
        context: { programme_admission_year_id: payId },
        format,
        filename: exportFilename(format),
        generate: async () => {
          const result = await this.engine.search(searchDto, options);
          const buffer =
            format === 'csv'
              ? rowsToCsv(result.columns, result.rows)
              : await rowsToXlsx(result.columns, result.rows);
          return { buffer, rowCount: result.total };
        },
      })
      .then(({ id }) => ({ job_id: id }));
  }
}
