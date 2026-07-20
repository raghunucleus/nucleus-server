import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';
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
import { DRIVE_STUDENT_STATUS } from './drive-student-status';
import {
  DriveStudentProfile,
  DriveStudentProfileService,
} from './drive-student-profile.service';
import { EligibilityExportDto } from './dto/eligibility-export.dto';
import { DriveStudent } from './entities/drive-student.entity';

/** Mirrors the engine's skip_pagination ceiling — checked up front so the
 *  caller gets an immediate 400 instead of a failed background job. */
const MAX_EXPORT_ROWS = 100_000;

/** One recorded selection, as the Placed-count hover card lists it. */
export interface StudentSelection {
  drive_id: number;
  drive_name: string;
  company_name: string;
  designation: string | null;
  offer_type: string | null;
  is_internship: boolean;
  is_full_time: boolean;
  /** LPA — the fixed amount or a range's MAX; `_min` set means a range. */
  ctc: number | null;
  ctc_min: number | null;
  /** ₹/month, same fixed-or-range convention as ctc. */
  stipend: number | null;
  stipend_min: number | null;
  drive_date: string | null;
}

/** The Academics hover card's payload. */
export interface StudentAcademics {
  /** 1 = Regular, 2 = Lateral — decides whether 12th % or Diploma % applies. */
  entry_type: number;
  tenth_percentage: number | null;
  twelfth_percentage: number | null;
  diploma_percentage: number | null;
  ug_cgpa: number | null;
  current_backlogs: number | null;
  backlog_history: boolean;
}

/** The export dialog's catalog — same shape the drive Students tab serves. */
export interface ExportColumnCatalog {
  groups: ReadonlyArray<{ key: string; label: string }>;
  columns: Array<{ key: string; label: string; group: string; kind: string }>;
  defaultColumns: string[];
}

/** The sheet the dialog opens on, mirroring the screen's default columns. */
const DEFAULT_EXPORT_COLUMNS = [
  'student_id',
  'display_name',
  'programme',
  'pass_out_year',
  'mobile_number',
  'email',
] as const;

/** Postgres `numeric` arrives as a string; NULL must stay NULL, not 0. */
function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

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
    @InjectRepository(DriveStudent)
    private readonly driveStudents: Repository<DriveStudent>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly profiles: DriveStudentProfileService,
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

  /**
   * The pickable export columns — every selectable student attribute, which
   * already includes `student_id` and `display_name` (both are real registry
   * attributes as well as implicit result columns). Same payload shape as the
   * drive Students tab's catalog, so both feed the one export dialog.
   */
  exportColumns(): ExportColumnCatalog {
    const meta = this.engine.meta('employee');
    return {
      groups: [...meta.groups],
      columns: meta.attributes
        .filter((a) => a.selectable)
        .map((a) => ({
          key: a.key,
          label: a.label,
          group: a.group,
          kind: a.kind,
        })),
      defaultColumns: [...DEFAULT_EXPORT_COLUMNS],
    };
  }

  /**
   * Every drive the student was SELECTED in — the Placed-count hover card.
   *
   * Includes internships as well as full-time offers (the table's `placed_count`
   * badge counts only full-time ones), tagged by the offer type's flags so the
   * card can show a stipend instead of a CTC. The designation and its offer type
   * come from the profile the student was picked for; a row selected before that
   * feature existed has none, hence the LEFT JOINs and the COALESCE onto the
   * drive-level offer type.
   */
  async placements(studentId: number): Promise<StudentSelection[]> {
    await this.assertStudentExists(studentId);
    const raw = await this.driveStudents
      .createQueryBuilder('ds')
      .innerJoin('drives', 'd', 'd.id = ds.drive_id')
      .innerJoin('companies', 'c', 'c.id = d.company_id')
      .leftJoin('drive_profiles', 'dp', 'dp.id = ds.selected_drive_profile_id')
      .leftJoin('drive_designations', 'dg', 'dg.id = dp.designation_id')
      .leftJoin(
        'drive_offer_types',
        'ot',
        'ot.id = COALESCE(dp.offer_type_id, d.offer_type_id)',
      )
      .select('d.id', 'drive_id')
      .addSelect('d.drive_name', 'drive_name')
      .addSelect('c.name', 'company_name')
      .addSelect('dg.name', 'designation')
      .addSelect('ot.name', 'offer_type')
      .addSelect('ot.is_internship', 'is_internship')
      .addSelect('ot.is_full_time', 'is_full_time')
      .addSelect('ds.ctc', 'ctc')
      .addSelect('ds.ctc_min', 'ctc_min')
      .addSelect('ds.stipend', 'stipend')
      .addSelect('ds.stipend_min', 'stipend_min')
      .addSelect('d.drive_date', 'drive_date')
      .where('ds.student_id = :studentId', { studentId })
      .andWhere('ds.status = :status', {
        status: DRIVE_STUDENT_STATUS.SELECTED,
      })
      .orderBy('d.drive_date', 'DESC', 'NULLS LAST')
      .addOrderBy('d.id', 'DESC')
      .getRawMany<Record<string, unknown>>();

    return raw.map((r) => ({
      drive_id: Number(r.drive_id),
      drive_name: String(r.drive_name),
      company_name: String(r.company_name),
      designation: (r.designation as string | null) ?? null,
      offer_type: (r.offer_type as string | null) ?? null,
      is_internship: r.is_internship === true,
      is_full_time: r.is_full_time === true,
      ctc: num(r.ctc),
      ctc_min: num(r.ctc_min),
      stipend: num(r.stipend),
      stipend_min: num(r.stipend_min),
      drive_date: (r.drive_date as string | null) ?? null,
    }));
  }

  /**
   * The Academics hover card — the prior-qualification and backlog fields, kept
   * off the table so the default column set stays readable. `entry_type` rides
   * along so the card can hide 12th % for a lateral entrant and Diploma % for a
   * regular one.
   */
  async academics(studentId: number): Promise<StudentAcademics> {
    const s = await this.students.findOne({
      where: { id: studentId },
      select: {
        id: true,
        entry_type: true,
        tenth_percentage: true,
        twelfth_percentage: true,
        diploma_percentage: true,
        ug_cgpa: true,
        current_backlogs: true,
        backlog_history: true,
      },
    });
    if (!s) throw new NotFoundException('Student not found.');
    return {
      entry_type: Number(s.entry_type),
      tenth_percentage: num(s.tenth_percentage),
      twelfth_percentage: num(s.twelfth_percentage),
      diploma_percentage: num(s.diploma_percentage),
      ug_cgpa: num(s.ug_cgpa),
      current_backlogs: s.current_backlogs ?? null,
      backlog_history: s.backlog_history === true,
    };
  }

  /**
   * The full profile behind a roll-number click — the same payload, from the
   * same service, that the drive Students tab's detail sheet renders.
   *
   * No membership or scope gate, unlike the drive-bound callers: this screen is
   * unscoped by design and its search already returns every student in the
   * institution, so a profile for a row the employee is already looking at
   * grants no additional reach. Government IDs stay excluded (the default),
   * matching the employee search surface.
   */
  profile(studentId: number): Promise<DriveStudentProfile> {
    return this.profiles.getProfile(studentId);
  }

  private async assertStudentExists(studentId: number): Promise<void> {
    const exists = await this.students.exists({ where: { id: studentId } });
    if (!exists) throw new NotFoundException('Student not found.');
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
    dto: EligibilityExportDto,
  ): Promise<{ job_id: number }> {
    if (dto.format !== 'csv' && dto.format !== 'xlsx') {
      throw new BadRequestException(
        'Export requires "format" to be "csv" or "xlsx".',
      );
    }
    const format = dto.format;

    // The sheet's layout, left to right. When the dialog sent one, it also
    // becomes the column set the engine must select — the on-screen `columns`
    // are irrelevant to the file.
    const sheetColumns = dto.export_columns?.length
      ? [...new Set(dto.export_columns)]
      : null;
    const searchColumns = sheetColumns ?? dto.columns;

    // Synchronous 1-row probe: re-validates filters/columns (bad input fails
    // the request, not a background job) and bounds the result set up front.
    const probe = await this.engine.search(
      {
        ...dto,
        columns: searchColumns,
        skip_pagination: false,
        page: 1,
        pageSize: 1,
        format: 'json',
      },
      { surface: 'employee' },
    );
    if (probe.total > MAX_EXPORT_ROWS) {
      throw new BadRequestException(
        `Result set too large to export (${probe.total} rows, max ${MAX_EXPORT_ROWS.toLocaleString('en-US')}). Narrow the filters.`,
      );
    }

    const searchDto: StudentSearchDto = {
      ...dto,
      columns: searchColumns,
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
          // The engine always emits the implicit keys first in its own order,
          // so the dialog's layout is applied here — a pure reorder/subset of
          // the columns just selected, no second query.
          const columns = sheetColumns ?? result.columns;
          const buffer =
            format === 'csv'
              ? rowsToCsv(columns, result.rows)
              : await rowsToXlsx(columns, result.rows);
          return { buffer, rowCount: result.total };
        },
      })
      .then(({ id }) => ({ job_id: id }));
  }
}
