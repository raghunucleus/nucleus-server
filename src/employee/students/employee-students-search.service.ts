import { BadRequestException, Injectable } from '@nestjs/common';
import { PermissionsService } from '../../rbac/permissions.service';
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

export const STUDENT_DIRECTORY_SCREEN_KEY = 'students.directory.view';

/** Mirrors the engine's skip_pagination ceiling — checked up front so the
 *  caller gets an immediate 400 instead of a failed background job. */
const MAX_EXPORT_ROWS = 100_000;

/**
 * Employee student directory — the RBAC-scoped wrapper around the shared
 * query engine. All four scope attributes are resolved for the screen and
 * intersected by the engine (three-state contract: 'all' = no predicate,
 * [] = empty result, ids = IN filter).
 */
@Injectable()
export class EmployeeStudentsSearchService {
  constructor(
    private readonly engine: StudentQueryService,
    private readonly permissions: PermissionsService,
    private readonly jobs: ExportJobsService,
  ) {}

  /** The employee's directory scope, shared by search and export. */
  private async scopeFor(employeeId: number): Promise<StudentQueryOptions> {
    const KEY = STUDENT_DIRECTORY_SCREEN_KEY;
    const [departmentIds, programmeIds, admissionYearIds, attendanceGroupIds] =
      await Promise.all([
        this.permissions.getAccessibleDepartmentIds(employeeId, KEY),
        this.permissions.getAccessibleProgrammeIds(employeeId, KEY),
        this.permissions.getAccessibleAdmissionYearIds(employeeId, KEY),
        this.permissions.getAccessibleAttendanceGroupIds(employeeId, KEY),
      ]);
    return {
      surface: 'employee',
      scope: {
        departmentIds,
        programmeIds,
        admissionYearIds,
        attendanceGroupIds,
      },
    };
  }

  async search(
    employeeId: number,
    dto: StudentSearchDto,
  ): Promise<StudentSearchResult> {
    if (dto.format !== 'json') {
      throw new BadRequestException(
        'File formats are not served inline. Use POST /employee/students/export to start an export job.',
      );
    }
    return this.engine.search(dto, await this.scopeFor(employeeId));
  }

  meta() {
    return this.engine.meta('employee');
  }

  options(lookup: string, q?: string) {
    return this.engine.fkOptions(lookup, q);
  }

  parseNql(nql: string) {
    return this.engine.parseNqlQuery(nql);
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
    // The probe and the job share these options, so the export matches exactly
    // what the screen was showing when the user asked for it.
    const options = await this.scopeFor(employeeId);

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
        source: 'students_directory',
        label: 'Student directory',
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
