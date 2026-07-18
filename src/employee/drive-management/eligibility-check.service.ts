import { BadRequestException, Injectable } from '@nestjs/common';
import { ExportJobsService } from '../exports/export-jobs.service';
import {
  StudentSearchDto,
  StudentSearchResult,
} from '../../student-query/dto/student-search.dto';
import {
  exportFilename,
  rowsToCsv,
  rowsToXlsx,
} from '../../student-query/export';
import { StudentQueryService } from '../../student-query/student-query.service';

/** Mirrors the engine's skip_pagination ceiling — checked up front so the
 *  caller gets an immediate 400 instead of a failed background job. */
const MAX_EXPORT_ROWS = 100_000;

/**
 * The "Eligibility check" screen: the drive Filter tab's registry-driven
 * student search without a drive — a standalone, institution-wide search the
 * placement cell uses for ad-hoc eligibility screening ("who would qualify?")
 * before any drive exists.
 *
 * Gated by `drive_management.eligibility_check.view`, which — like
 * `drive_management.drives.manage` — has NO per-attribute scope
 * (`attributes: []` in the catalog), so the engine runs WITHOUT an RBAC scope
 * object: the whole institution, employee attribute set (gov-ID fields
 * excluded).
 *
 * Exports are ALWAYS async, via the generic exports framework.
 */
@Injectable()
export class EligibilityCheckService {
  constructor(
    private readonly engine: StudentQueryService,
    private readonly jobs: ExportJobsService,
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

  async search(dto: StudentSearchDto): Promise<StudentSearchResult> {
    if (dto.format !== 'json') {
      throw new BadRequestException(
        'File formats are not served inline. Use POST .../students/export to start an export job.',
      );
    }
    return this.engine.search(dto, { surface: 'employee' });
  }

  async export(
    employeeId: number,
    dto: StudentSearchDto,
  ): Promise<{ job_id: number }> {
    if (dto.format !== 'csv' && dto.format !== 'xlsx') {
      throw new BadRequestException(
        'Export requires "format" to be "csv" or "xlsx".',
      );
    }
    const format = dto.format;

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

    const searchDto = {
      ...dto,
      skip_pagination: true,
      page: 1,
      format: 'json' as const,
    };
    return this.jobs
      .create({
        employeeId,
        source: 'eligibility_check',
        label: 'Eligibility check — students',
        context: {},
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
}
