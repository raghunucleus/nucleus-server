import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  StudentSearchDto,
  StudentSearchResult,
} from '../../../student-query/dto/student-search.dto';
import {
  exportFilename,
  rowsToCsv,
  rowsToXlsx,
} from '../../../student-query/export';
import {
  StudentQueryOptions,
  StudentQueryService,
} from '../../../student-query/student-query.service';
import { ACCESS_ALL } from '../../../rbac/permissions.service';
import { ExportJobsService } from '../../exports/export-jobs.service';
import { InsightsScope } from '../insights-scope.service';
import { SCOPE_STUDENTS_CTE, num } from '../insights.sql';

const MAX_EXPORT_ROWS = 100_000;

export interface DemographicsRow {
  pay_id: number;
  total: number;
  inactive: number;
  male: number;
  female: number;
  other: number;
  regular: number;
  lateral: number;
  with_guardian: number;
  with_photo: number;
  with_aadhaar: number;
  with_resume: number;
  with_abc_id: number;
  with_personal_email: number;
}

export interface DemographicsResult {
  by_batch: DemographicsRow[];
  districts: Array<{ district: string; state: string; students: number }>;
}

/**
 * Cohort composition and the scoped cohort explorer.
 *
 * The explorer is the shared student-query engine with the insights scope
 * translated to a `StudentQueryScope`: departments, programmes and admission
 * years from the resolved batches, sections only when the caller narrowed to
 * some. Batches are a (programme × year) set here rather than pairs — the
 * engine has no pair predicate — which can over-include when a caller narrows
 * to two batches of different programmes AND different years. The demographic
 * counts use the exact pair set.
 */
@Injectable()
export class InsightsStudentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly engine: StudentQueryService,
    private readonly jobs: ExportJobsService,
  ) {}

  async demographics(scope: InsightsScope): Promise<DemographicsResult> {
    if (scope.payIds.length === 0) return { by_batch: [], districts: [] };
    const params: [number[], number[] | null] = [
      scope.payIds,
      scope.groupFilter,
    ];
    const [rows, inactive, districts] = await Promise.all([
      this.dataSource.query<Array<Record<string, string>>>(
        `${SCOPE_STUDENTS_CTE}
         SELECT st.pay_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE s.gender = 'male') AS male,
                COUNT(*) FILTER (WHERE s.gender = 'female') AS female,
                COUNT(*) FILTER (WHERE s.gender NOT IN ('male','female')) AS other,
                COUNT(*) FILTER (WHERE s.entry_type = 1) AS regular,
                COUNT(*) FILTER (WHERE s.entry_type = 2) AS lateral,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM student_guardians sg WHERE sg.student_id = s.id)) AS with_guardian,
                COUNT(*) FILTER (WHERE s.photo_key IS NOT NULL) AS with_photo,
                COUNT(*) FILTER (WHERE s.aadhaar_number IS NOT NULL) AS with_aadhaar,
                COUNT(*) FILTER (WHERE s.resume_external_url IS NOT NULL) AS with_resume,
                COUNT(*) FILTER (WHERE s.abc_id IS NOT NULL) AS with_abc_id,
                COUNT(*) FILTER (WHERE s.personal_email IS NOT NULL) AS with_personal_email
           FROM st
           JOIN students s ON s.id = st.student_id
          GROUP BY st.pay_id
          ORDER BY st.pay_id`,
        params,
      ),
      this.dataSource.query<Array<{ pay_id: number; inactive: string }>>(
        `SELECT pay.id AS pay_id, COUNT(s.id) AS inactive
           FROM programme_admission_years pay
           LEFT JOIN students s
             ON s.programme_id = pay.programme_id
            AND s.admission_year_id = pay.admission_year_id
            AND s.is_active = FALSE
          WHERE pay.id = ANY($1::int[])
          GROUP BY pay.id`,
        [scope.payIds],
      ),
      this.dataSource.query<Array<Record<string, string>>>(
        `${SCOPE_STUDENTS_CTE}
         SELECT d.name AS district, stt.name AS state, COUNT(*) AS students
           FROM st
           JOIN students s ON s.id = st.student_id
           JOIN districts d ON d.id = s.home_district_id
           JOIN states stt ON stt.id = d.state_id
          GROUP BY d.name, stt.name
          ORDER BY students DESC
          LIMIT 12`,
        params,
      ),
    ]);
    const inactiveByPay = new Map(
      inactive.map((r) => [num(r.pay_id), num(r.inactive)]),
    );
    return {
      by_batch: rows.map((r) => ({
        pay_id: num(r.pay_id),
        total: num(r.total),
        inactive: inactiveByPay.get(num(r.pay_id)) ?? 0,
        male: num(r.male),
        female: num(r.female),
        other: num(r.other),
        regular: num(r.regular),
        lateral: num(r.lateral),
        with_guardian: num(r.with_guardian),
        with_photo: num(r.with_photo),
        with_aadhaar: num(r.with_aadhaar),
        with_resume: num(r.with_resume),
        with_abc_id: num(r.with_abc_id),
        with_personal_email: num(r.with_personal_email),
      })),
      districts: districts.map((r) => ({
        district: r.district,
        state: r.state,
        students: num(r.students),
      })),
    };
  }

  // --- cohort explorer ----------------------------------------------------

  private options(scope: InsightsScope | null): StudentQueryOptions {
    if (!scope || scope.payIds.length === 0) {
      // `[]` = no rows, per the engine's three-state contract.
      return { surface: 'employee', scope: { programmeIds: [] } };
    }
    return {
      surface: 'employee',
      scope: {
        departmentIds: [...new Set(scope.batches.map((b) => b.department_id))],
        programmeIds: [...new Set(scope.batches.map((b) => b.programme_id))],
        admissionYearIds: [
          ...new Set(scope.batches.map((b) => b.admission_year_id)),
        ],
        attendanceGroupIds: scope.groupFilter ?? ACCESS_ALL,
      },
    };
  }

  async search(
    scope: InsightsScope | null,
    dto: StudentSearchDto,
  ): Promise<StudentSearchResult> {
    if (dto.format !== 'json') {
      throw new BadRequestException(
        'File formats are not served inline. Use POST /employee/insights/students/export to start an export job.',
      );
    }
    return this.engine.search(dto, this.options(scope));
  }

  meta() {
    return this.engine.meta('employee');
  }

  fkOptions(lookup: string, q?: string) {
    return this.engine.fkOptions(lookup, q);
  }

  parseNql(nql: string) {
    return this.engine.parseNqlQuery(nql);
  }

  async export(
    employeeId: number,
    scope: InsightsScope | null,
    dto: StudentSearchDto,
  ): Promise<{ job_id: number }> {
    if (dto.format !== 'csv' && dto.format !== 'xlsx') {
      throw new BadRequestException(
        'Export requires "format" to be "csv" or "xlsx".',
      );
    }
    const format = dto.format;
    const options = this.options(scope);
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
        source: 'insights_students',
        label: 'Student insights cohort',
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
