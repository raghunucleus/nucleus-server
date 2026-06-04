import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProgrammeAdmissionYear } from '../../admin/entities/programme-admission-year.entity';
import { Student } from '../../admin/entities/student.entity';
import { ACCESS_ALL, PermissionsService } from '../../rbac/permissions.service';
import { CHUNK_MAX_ROWS } from './dto/upload-marks.dto';
import {
  GRADE_MEANING_MAP,
  GRADE_POINT_MAP,
  GRADES,
  type Grade,
  parseExamination,
} from './exam-marks.constants';
import { groupSubjectsBySemester } from './exam-results-grouping';
import { StudentNotificationService } from '../../student/notification/student-notification.service';
import { StudentCgpa } from './entities/student-cgpa.entity';
import { StudentExamResult } from './entities/student-exam-result.entity';
import { StudentExamResultStaging } from './entities/student-exam-result-staging.entity';
import { StudentSemesterGpa } from './entities/student-semester-gpa.entity';

const SCREEN_KEY = 'examinations.marks.upload';

/**
 * The read-only "Student marks" screen. Its endpoints reuse the cached-read
 * service methods below; passing this key makes the scope helpers resolve
 * against the view grant (derived from upload — see PermissionsService).
 */
export const VIEW_SCREEN_KEY = 'examinations.marks.view';

/** Generous safety backstop — far above any real batch; never hit in normal use. */
const MAX_SESSION_ROWS = 1_000_000;

/** One accessible (programme × admission-year) batch, for the filter dropdown. */
export interface ExamMarksScopeItem {
  id: number;
  programme_id: number;
  programme_name: string;
  programme_code: string;
  admission_year_id: number;
  admission_year_display: string;
  label: string;
}

/** One parsed spreadsheet row, every cell a string (see UploadMarksDto). */
export interface UploadMarksRow {
  examination: string;
  exam_date: string;
  roll_number: string;
  subject_code: string;
  subject_name: string;
  credits: string;
  grade: string;
  grade_points: string;
}

/**
 * A row-level validation problem. `row` is the 0-based index into the whole
 * submitted sheet (chunk offset + position); the upload screen highlights that
 * row's `column` cell.
 */
export interface RowError {
  row: number;
  column: string;
  value?: string;
  reason: string;
}

/** One sitting of a subject (oldest → newest), for the attempts expander. */
export interface AttemptDetail {
  exam_type: string;
  exam_date: string;
  credits: number;
  grade: string;
  grade_points: number;
  grade_meaning: string;
  is_best: boolean;
}

/** One subject in a student's computed semester (the best attempt + history). */
export interface PreviewSubject {
  subject_code: string;
  subject_name: string;
  credits: number;
  grade: string;
  grade_points: number;
  grade_meaning: string;
  exam_type: string;
  exam_date: string;
  attempts: number;
  attempts_detail: AttemptDetail[];
}

export interface PreviewSemester {
  semester: number;
  sgpa: number;
  total_credits: number;
  credit_points: number;
  subjects_count: number;
  passed_count: number;
  backlog_count: number;
  passed: boolean;
  subjects: PreviewSubject[];
}

export interface PreviewStudent {
  student_id: number;
  roll_number: string;
  name: string;
  cgpa: number;
  total_credits: number;
  backlog_count: number;
  semesters_count: number;
  semesters: PreviewSemester[];
}

/** Per-semester summary in the preview list (no subject-level detail). */
export interface SemesterSummary {
  semester: number;
  sgpa: number;
  total_credits: number;
  subjects_count: number;
  passed_count: number;
  backlog_count: number;
  passed: boolean;
}

/** One student in the preview list — totals + per-semester SGPA, no subjects. */
export interface StudentSummary {
  student_id: number;
  roll_number: string;
  name: string;
  cgpa: number;
  total_credits: number;
  backlog_count: number;
  semesters_count: number;
  semesters: SemesterSummary[];
}

export interface StartUploadResult {
  upload_session: string;
}

export interface ChunkResult {
  inserted: number;
  errors: RowError[];
}

/** Result of preview — computed from staging, nothing written to result tables. */
export interface PreviewResult {
  programme_admission_year_id: number;
  valid: boolean;
  total_rows: number;
  error_count: number;
  errors: RowError[];
  students: StudentSummary[];
}

/** Result of commit — the batch was overwritten. */
export interface CommitResult {
  programme_admission_year_id: number;
  valid: boolean;
  persisted: boolean;
  errors: RowError[];
  summary?: { students: number; results_stored: number; semesters: number };
}

/** A row that passed validation, normalised into typed values. */
interface NormRow {
  studentId: number;
  roll_number: string;
  semester: number;
  exam_type: string;
  exam_date: string;
  subject_code: string;
  subject_name: string;
  credits: number;
  grade: string;
  grade_points: number;
}

type FlaggedRow = NormRow & { is_best: boolean };

interface ComputedStudent extends PreviewStudent {
  credit_points: number;
  subjects_count: number;
  passed_count: number;
  rows: FlaggedRow[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class ExamMarksService {
  private readonly logger = new Logger('ExamMarksService');

  constructor(
    @InjectRepository(ProgrammeAdmissionYear)
    private readonly batches: Repository<ProgrammeAdmissionYear>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(StudentExamResult)
    private readonly examResults: Repository<StudentExamResult>,
    @InjectRepository(StudentSemesterGpa)
    private readonly semesterGpas: Repository<StudentSemesterGpa>,
    @InjectRepository(StudentCgpa)
    private readonly cgpas: Repository<StudentCgpa>,
    @InjectRepository(StudentExamResultStaging)
    private readonly staging: Repository<StudentExamResultStaging>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    private readonly notifications: StudentNotificationService,
  ) {}

  /**
   * The (programme × admission-year) batches the employee may upload marks
   * for. Honours the three-state scope contract:
   *   'all' → every active batch, [] → none, [ids] → exactly those.
   */
  async scope(
    employeeId: number,
    screenKey: string = SCREEN_KEY,
  ): Promise<ExamMarksScopeItem[]> {
    const accessible =
      await this.permissions.getAccessibleProgrammeAdmissionYearIds(
        employeeId,
        screenKey,
      );

    if (accessible !== ACCESS_ALL && accessible.length === 0) return [];

    const qb = this.batches
      .createQueryBuilder('pay')
      .leftJoin('pay.programme', 'p')
      .leftJoin('pay.admission_year', 'ay')
      .select(['pay.id', 'pay.programme_id', 'pay.admission_year_id'])
      .addSelect(['p.name', 'p.code', 'ay.display_year'])
      .where('pay.is_active = TRUE');

    if (accessible !== ACCESS_ALL) {
      qb.andWhere('pay.id IN (:...ids)', { ids: accessible });
    }

    qb.orderBy('p.name', 'ASC').addOrderBy('ay.display_year', 'DESC');

    const rows = await qb.getMany();
    return rows.map((pay) => {
      const programme_name = pay.programme?.name ?? '—';
      const admission_year_display = pay.admission_year?.display_year ?? '—';
      return {
        id: pay.id,
        programme_id: pay.programme_id,
        programme_name,
        programme_code: pay.programme?.code ?? '',
        admission_year_id: pay.admission_year_id,
        admission_year_display,
        label: `${programme_name} / ${admission_year_display}`,
      };
    });
  }

  // ---- chunked upload ---------------------------------------------------

  /**
   * Open an upload session for a batch. Sweeps any prior staging rows for this
   * batch (it is about to be fully replaced) and this employee, so abandoned
   * sessions are reclaimed here (no cron). Returns a fresh session id.
   */
  async startUpload(
    employeeId: number,
    programmeAdmissionYearId: number,
  ): Promise<StartUploadResult> {
    await this.assertBatchExistsInScope(employeeId, programmeAdmissionYearId);
    await this.staging
      .createQueryBuilder()
      .delete()
      .where('programme_admission_year_id = :b OR employee_id = :e', {
        b: programmeAdmissionYearId,
        e: employeeId,
      })
      .execute();
    return { upload_session: randomUUID() };
  }

  /**
   * Validate + parse one chunk of rows and stage them. Field/grading validation
   * is entirely server-side; errors are stored on the staging row (first error)
   * and also returned for immediate per-cell highlighting on the grid.
   */
  async uploadChunk(
    employeeId: number,
    programmeAdmissionYearId: number,
    uploadSession: string,
    offset: number,
    rows: UploadMarksRow[],
  ): Promise<ChunkResult> {
    const batch = await this.assertBatchExistsInScope(
      employeeId,
      programmeAdmissionYearId,
    );

    const existing = await this.staging.count({
      where: { upload_session: uploadSession },
    });
    if (existing + rows.length > MAX_SESSION_ROWS) {
      throw new ForbiddenException(
        `Upload exceeds the ${MAX_SESSION_ROWS.toLocaleString()}-row limit`,
      );
    }

    // Resolve only the roll numbers present in this chunk (bounded by chunk size).
    const rolls = [...new Set(rows.map((r) => r.roll_number.trim()))].filter(
      Boolean,
    );
    const rosterMeta = await this.rosterFor(batch, rolls);

    const errors: RowError[] = [];
    const stagingRows: Partial<StudentExamResultStaging>[] = rows.map(
      (row, i) => {
        const rowIndex = offset + i;
        const built = this.buildStagingRow(row, rosterMeta);
        for (const e of built.errors) {
          errors.push({ row: rowIndex, ...e });
        }
        return {
          upload_session: uploadSession,
          employee_id: employeeId,
          programme_admission_year_id: programmeAdmissionYearId,
          row_index: rowIndex,
          ...built.fields,
        };
      },
    );

    await insertChunked(this.staging, stagingRows);
    return { inserted: rows.length, errors };
  }

  /**
   * Validate the staged session and, if clean, compute the student-wise summary
   * (per-semester SGPA + CGPA) via set-based SQL over staging — no writes, no
   * subject detail (fetched on demand via `studentUploadDetail`).
   */
  async previewUpload(
    employeeId: number,
    programmeAdmissionYearId: number,
    uploadSession: string,
  ): Promise<PreviewResult> {
    await this.assertBatchExistsInScope(employeeId, programmeAdmissionYearId);

    const total = await this.staging.count({
      where: {
        upload_session: uploadSession,
        programme_admission_year_id: programmeAdmissionYearId,
      },
    });

    const errorQb = () =>
      this.staging
        .createQueryBuilder('s')
        .where('s.upload_session = :u AND s.programme_admission_year_id = :b', {
          u: uploadSession,
          b: programmeAdmissionYearId,
        })
        .andWhere('s.error_reason IS NOT NULL');

    const errorList = await errorQb()
      .select([
        's.row_index AS row_index',
        's.error_column AS error_column',
        's.error_reason AS error_reason',
      ])
      .orderBy('s.row_index', 'ASC')
      .limit(500)
      .getRawMany();

    if (errorList.length > 0) {
      const errorCount = await errorQb().getCount();
      return {
        programme_admission_year_id: programmeAdmissionYearId,
        valid: false,
        total_rows: total,
        error_count: errorCount,
        errors: errorList.map((e) => ({
          row: Number(e.row_index),
          column: e.error_column,
          reason: e.error_reason,
        })),
        students: [],
      };
    }

    const students = await this.summariseStaging(
      uploadSession,
      programmeAdmissionYearId,
    );
    return {
      programme_admission_year_id: programmeAdmissionYearId,
      valid: true,
      total_rows: total,
      error_count: 0,
      errors: [],
      students,
    };
  }

  /**
   * One student's full detail (semesters → best subjects → all attempts),
   * computed server-side from the staged session on demand (small payload).
   */
  async studentUploadDetail(
    employeeId: number,
    programmeAdmissionYearId: number,
    uploadSession: string,
    studentId: number,
  ): Promise<PreviewStudent> {
    await this.assertBatchExistsInScope(employeeId, programmeAdmissionYearId);

    const staged = await this.staging.find({
      where: {
        upload_session: uploadSession,
        programme_admission_year_id: programmeAdmissionYearId,
        student_id: studentId,
      },
    });
    if (staged.length === 0) {
      throw new NotFoundException('No staged rows for this student');
    }

    const student = await this.students.findOne({
      where: { id: studentId },
      select: { id: true, student_id: true, display_name: true },
    });
    const meta = new Map<string, { id: number; name: string }>([
      [
        student?.student_id ?? String(studentId),
        { id: studentId, name: student?.display_name ?? '' },
      ],
    ]);

    const norm: NormRow[] = staged.map((s) => ({
      studentId,
      roll_number: student?.student_id ?? '',
      semester: s.semester as number,
      exam_type: s.exam_type as string,
      exam_date: s.exam_date as string,
      subject_code: s.subject_code,
      subject_name: s.subject_name,
      credits: Number(s.credits),
      grade: s.grade,
      grade_points: Number(s.grade_points),
    }));

    const computed = this.computeBatch(norm, meta);
    return stripInternal(computed[0]);
  }

  /**
   * Atomically replace ALL stored data for the batch from the staged session:
   * advisory-lock the batch, delete the 3 result tables, INSERT…SELECT the raw
   * results (is_best via window) and the aggregated SGPA/CGPA, then delete the
   * session's staging rows — all in one transaction. All-or-nothing: refuses if
   * any staged row is invalid.
   */
  async commitUpload(
    employeeId: number,
    programmeAdmissionYearId: number,
    uploadSession: string,
    notify = true,
  ): Promise<CommitResult> {
    await this.assertBatchExistsInScope(employeeId, programmeAdmissionYearId);

    const badCount = await this.staging
      .createQueryBuilder('s')
      .where('s.upload_session = :u AND s.programme_admission_year_id = :b', {
        u: uploadSession,
        b: programmeAdmissionYearId,
      })
      .andWhere('s.error_reason IS NOT NULL')
      .getCount();
    if (badCount > 0) {
      return {
        programme_admission_year_id: programmeAdmissionYearId,
        valid: false,
        persisted: false,
        errors: [
          { row: -1, column: '', reason: `${badCount} invalid row(s) remain` },
        ],
      };
    }

    let resultsStored = 0;
    let semesters = 0;
    let studentsCount = 0;
    let storedStudentIds: number[] = [];

    await this.dataSource.transaction(async (tx) => {
      // Serialise concurrent commits to the same batch — last full replace wins.
      await tx.query('SELECT pg_advisory_xact_lock($1)', [
        programmeAdmissionYearId,
      ]);

      await tx.query(
        `DELETE FROM "student_cgpa" WHERE "programme_admission_year_id" = $1`,
        [programmeAdmissionYearId],
      );
      await tx.query(
        `DELETE FROM "student_semester_gpa" WHERE "programme_admission_year_id" = $1`,
        [programmeAdmissionYearId],
      );
      await tx.query(
        `DELETE FROM "student_exam_results" WHERE "programme_admission_year_id" = $1`,
        [programmeAdmissionYearId],
      );

      // Raw results — is_best = the highest grade_points sitting per
      // (student, semester, subject), tie-broken by the latest exam_date.
      await tx.query(
        `INSERT INTO "student_exam_results"
           ("programme_admission_year_id", "student_id", "semester", "exam_type",
            "exam_date", "subject_code", "subject_name", "credits",
            "grade", "grade_points", "is_best", "created_at")
         SELECT s."programme_admission_year_id", s."student_id", s."semester", s."exam_type",
                s."exam_date", s."subject_code", s."subject_name", s."credits",
                s."grade", s."grade_points",
                (ROW_NUMBER() OVER (
                   PARTITION BY s."student_id", s."semester", s."subject_code"
                   ORDER BY s."grade_points" DESC, s."exam_date" DESC) = 1),
                now()
         FROM "student_exam_result_staging" s
         WHERE s."upload_session" = $1 AND s."programme_admission_year_id" = $2`,
        [uploadSession, programmeAdmissionYearId],
      );

      // Cached SGPA + per-semester aggregates, from the best attempts.
      await tx.query(
        `INSERT INTO "student_semester_gpa"
           ("programme_admission_year_id", "student_id", "semester", "sgpa",
            "total_credits", "credit_points", "subjects_count", "passed_count",
            "backlog_count", "computed_at")
         SELECT "programme_admission_year_id", "student_id", "semester",
                COALESCE(ROUND(SUM("credits" * "grade_points") / NULLIF(SUM("credits"), 0), 2), 0),
                SUM("credits"), SUM("credits" * "grade_points"), COUNT(*),
                SUM(CASE WHEN "grade" = 'F' THEN 0 ELSE 1 END),
                SUM(CASE WHEN "grade" = 'F' THEN 1 ELSE 0 END),
                now()
         FROM "student_exam_results"
         WHERE "programme_admission_year_id" = $1 AND "is_best" = TRUE
         GROUP BY "programme_admission_year_id", "student_id", "semester"`,
        [programmeAdmissionYearId],
      );

      // Cached CGPA + per-student aggregates, from the best attempts.
      await tx.query(
        `INSERT INTO "student_cgpa"
           ("programme_admission_year_id", "student_id", "cgpa", "total_credits",
            "credit_points", "semesters_count", "subjects_count", "passed_count",
            "backlog_count", "computed_at")
         SELECT "programme_admission_year_id", "student_id",
                COALESCE(ROUND(SUM("credits" * "grade_points") / NULLIF(SUM("credits"), 0), 2), 0),
                SUM("credits"), SUM("credits" * "grade_points"),
                COUNT(DISTINCT "semester"), COUNT(*),
                SUM(CASE WHEN "grade" = 'F' THEN 0 ELSE 1 END),
                SUM(CASE WHEN "grade" = 'F' THEN 1 ELSE 0 END),
                now()
         FROM "student_exam_results"
         WHERE "programme_admission_year_id" = $1 AND "is_best" = TRUE
         GROUP BY "programme_admission_year_id", "student_id"`,
        [programmeAdmissionYearId],
      );

      // Authoritative counts for the summary (the Postgres INSERT return shape
      // is not a reliable [rows, affected] tuple, so count the stored rows).
      const counts = await tx.query(
        `SELECT
           (SELECT COUNT(*)::int FROM "student_exam_results" WHERE "programme_admission_year_id" = $1) AS results,
           (SELECT COUNT(*)::int FROM "student_semester_gpa" WHERE "programme_admission_year_id" = $1) AS semesters,
           (SELECT COUNT(*)::int FROM "student_cgpa" WHERE "programme_admission_year_id" = $1) AS students`,
        [programmeAdmissionYearId],
      );
      resultsStored = counts?.[0]?.results ?? 0;
      semesters = counts?.[0]?.semesters ?? 0;
      studentsCount = counts?.[0]?.students ?? 0;

      // The exact set of students whose results were just stored — drives the
      // optional "results published" notification after the transaction commits.
      if (notify) {
        const idRows: Array<{ student_id: number }> = await tx.query(
          `SELECT "student_id" FROM "student_cgpa" WHERE "programme_admission_year_id" = $1`,
          [programmeAdmissionYearId],
        );
        storedStudentIds = idRows.map((r) => Number(r.student_id));
      }

      // Clear the session's scratch rows — same transaction, so a rollback keeps
      // them for a retry.
      await tx.query(
        `DELETE FROM "student_exam_result_staging" WHERE "upload_session" = $1`,
        [uploadSession],
      );
    });

    // Results are durably stored at this point. Notify is best-effort: never let
    // a notification failure surface as a commit failure (the data is safe).
    if (notify && storedStudentIds.length > 0) {
      void this.notifications
        .send(storedStudentIds, {
          module: 'exam-marks',
          type: 'results-published',
          title: 'Exam results published',
          body: 'Your latest exam results are now available. Tap to view your grades and SGPA.',
          target: { type: 'results' },
        })
        .catch((err) =>
          this.logger.error(
            `Exam-results notification failed for batch ${programmeAdmissionYearId}: ${String(err)}`,
          ),
        );
    }

    return {
      programme_admission_year_id: programmeAdmissionYearId,
      valid: true,
      persisted: true,
      errors: [],
      summary: {
        students: studentsCount,
        results_stored: resultsStored,
        semesters,
      },
    };
  }

  // ---- cached reads (unchanged) ----------------------------------------

  /** Scope-checked roster of the batch with cached CGPA — pure SELECT. */
  async results(
    employeeId: number,
    programmeAdmissionYearId: number,
    screenKey: string = SCREEN_KEY,
  ) {
    await this.assertBatchInScope(
      employeeId,
      programmeAdmissionYearId,
      screenKey,
    );
    const rows = await this.cgpas
      .createQueryBuilder('c')
      .innerJoin(Student, 's', 's.id = c.student_id')
      .select([
        'c.student_id AS student_id',
        's.student_id AS roll_number',
        's.display_name AS name',
        'c.cgpa AS cgpa',
        'c.total_credits AS total_credits',
        'c.semesters_count AS semesters_count',
        'c.backlog_count AS backlog_count',
      ])
      .where('c.programme_admission_year_id = :id', {
        id: programmeAdmissionYearId,
      })
      .orderBy('s.student_id', 'ASC')
      .getRawMany();

    return rows.map((r) => ({
      student_id: Number(r.student_id),
      roll_number: r.roll_number,
      name: r.name,
      cgpa: Number(r.cgpa),
      total_credits: Number(r.total_credits),
      semesters_count: Number(r.semesters_count),
      backlog_count: Number(r.backlog_count),
    }));
  }

  /**
   * One student's stored results — cached CGPA + per-semester SGPA + the
   * subject rows. `include='best'` (default) returns only the attempts used in
   * the calculation; `include='all'` returns every sitting. Pure SELECTs.
   */
  async studentResults(
    employeeId: number,
    programmeAdmissionYearId: number,
    studentId: number,
    include: 'best' | 'all',
    screenKey: string = SCREEN_KEY,
  ) {
    await this.assertBatchInScope(
      employeeId,
      programmeAdmissionYearId,
      screenKey,
    );

    const cgpa = await this.cgpas.findOne({
      where: {
        programme_admission_year_id: programmeAdmissionYearId,
        student_id: studentId,
      },
    });
    if (!cgpa) {
      throw new NotFoundException('No stored results for this student');
    }

    const student = await this.students.findOne({
      where: { id: studentId },
      select: { id: true, student_id: true, display_name: true },
    });

    const semesterRows = await this.semesterGpas.find({
      where: {
        programme_admission_year_id: programmeAdmissionYearId,
        student_id: studentId,
      },
      order: { semester: 'ASC' },
    });

    const subjectQb = this.examResults
      .createQueryBuilder('r')
      .where('r.programme_admission_year_id = :id', {
        id: programmeAdmissionYearId,
      })
      .andWhere('r.student_id = :sid', { sid: studentId });
    if (include === 'best') subjectQb.andWhere('r.is_best = TRUE');
    const subjectRows = await subjectQb
      .orderBy('r.semester', 'ASC')
      .addOrderBy('r.subject_code', 'ASC')
      .addOrderBy('r.exam_date', 'ASC')
      .getMany();

    const subjectsBySemester = new Map<number, PreviewSubject[]>();
    for (const r of subjectRows) {
      const list = subjectsBySemester.get(r.semester) ?? [];
      list.push({
        subject_code: r.subject_code,
        subject_name: r.subject_name,
        credits: Number(r.credits),
        grade: r.grade,
        grade_points: Number(r.grade_points),
        grade_meaning: GRADE_MEANING_MAP[r.grade as Grade] ?? '',
        exam_type: r.exam_type,
        exam_date: r.exam_date,
        attempts: 1,
        attempts_detail: [],
      });
      subjectsBySemester.set(r.semester, list);
    }

    return {
      student: {
        student_id: studentId,
        roll_number: student?.student_id ?? '',
        name: student?.display_name ?? '',
      },
      cgpa: Number(cgpa.cgpa),
      total_credits: Number(cgpa.total_credits),
      semesters_count: cgpa.semesters_count,
      backlog_count: cgpa.backlog_count,
      include,
      semesters: semesterRows.map((sem) => ({
        semester: sem.semester,
        sgpa: Number(sem.sgpa),
        total_credits: Number(sem.total_credits),
        credit_points: Number(sem.credit_points),
        subjects_count: sem.subjects_count,
        passed_count: sem.passed_count,
        backlog_count: sem.backlog_count,
        passed: sem.backlog_count === 0,
        subjects: subjectsBySemester.get(sem.semester) ?? [],
      })),
    };
  }

  /**
   * One student's stored results in the SAME shape the student sees on their
   * own results page: per-semester SGPA + subjects, each subject carrying its
   * full sitting history (best attempt as the headline). Scope-checked, pure
   * SELECTs. Drives the exam-cell "Student marks" drill-down.
   */
  async studentResultsView(
    employeeId: number,
    programmeAdmissionYearId: number,
    studentId: number,
    screenKey: string = SCREEN_KEY,
  ) {
    await this.assertBatchInScope(
      employeeId,
      programmeAdmissionYearId,
      screenKey,
    );

    const cgpa = await this.cgpas.findOne({
      where: {
        programme_admission_year_id: programmeAdmissionYearId,
        student_id: studentId,
      },
    });
    if (!cgpa) {
      throw new NotFoundException('No stored results for this student');
    }

    const student = await this.students.findOne({
      where: { id: studentId },
      select: { id: true, student_id: true, display_name: true },
    });

    const semesterRows = await this.semesterGpas.find({
      where: {
        programme_admission_year_id: programmeAdmissionYearId,
        student_id: studentId,
      },
      order: { semester: 'ASC' },
    });

    // All sittings so the drill-down can expand a subject's attempt history.
    const subjectRows = await this.examResults.find({
      where: {
        programme_admission_year_id: programmeAdmissionYearId,
        student_id: studentId,
      },
      order: { semester: 'ASC', subject_code: 'ASC', exam_date: 'ASC' },
    });
    const subjectsBySemester = groupSubjectsBySemester(subjectRows);

    return {
      student: {
        student_id: studentId,
        roll_number: student?.student_id ?? '',
        name: student?.display_name ?? '',
      },
      cgpa: Number(cgpa.cgpa),
      total_credits: Number(cgpa.total_credits),
      semesters_count: cgpa.semesters_count,
      subjects_count: cgpa.subjects_count,
      passed_count: cgpa.passed_count,
      backlog_count: cgpa.backlog_count,
      semesters: semesterRows.map((sem) => ({
        semester: sem.semester,
        sgpa: Number(sem.sgpa),
        total_credits: Number(sem.total_credits),
        subjects_count: sem.subjects_count,
        passed_count: sem.passed_count,
        backlog_count: sem.backlog_count,
        passed: sem.backlog_count === 0,
        subjects: subjectsBySemester.get(sem.semester) ?? [],
      })),
    };
  }

  /**
   * Look up one student's results by HT number (student roll), across the
   * employee's assigned batches. Resolves the roll → student → their batch,
   * then delegates to {@link studentResultsView} which scope-checks that batch
   * (so a roll outside the caller's grants is rejected). Drives the "by HT
   * number" lookup on the Student marks screen.
   */
  async studentResultsByRoll(
    employeeId: number,
    rollNumber: string,
    screenKey: string = SCREEN_KEY,
  ) {
    const roll = rollNumber.trim();
    const student = await this.students.findOne({
      where: { student_id: roll },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException('No student with this HT number');
    }

    // The cached CGPA row carries the student's batch; one row per student.
    const cgpa = await this.cgpas.findOne({ where: { student_id: student.id } });
    if (!cgpa) {
      throw new NotFoundException('No stored results for this student');
    }

    return this.studentResultsView(
      employeeId,
      cgpa.programme_admission_year_id,
      student.id,
      screenKey,
    );
  }

  // ---- internals --------------------------------------------------------

  /** Set-based SQL summary (per-student CGPA + per-semester SGPA) from staging. */
  private async summariseStaging(
    uploadSession: string,
    batchId: number,
  ): Promise<StudentSummary[]> {
    const bestCte = `
      WITH best AS (
        SELECT s.*, ROW_NUMBER() OVER (
                 PARTITION BY s."student_id", s."semester", s."subject_code"
                 ORDER BY s."grade_points" DESC, s."exam_date" DESC) AS rn
        FROM "student_exam_result_staging" s
        WHERE s."upload_session" = $1 AND s."programme_admission_year_id" = $2
      )`;

    const cgpaRows = await this.dataSource.query(
      `${bestCte}
       SELECT b."student_id" AS student_id, st."student_id" AS roll_number,
              st."display_name" AS name,
              COALESCE(ROUND(SUM(b."credits" * b."grade_points") / NULLIF(SUM(b."credits"), 0), 2), 0) AS cgpa,
              SUM(b."credits") AS total_credits,
              COUNT(DISTINCT b."semester") AS semesters_count,
              SUM(CASE WHEN b."grade" = 'F' THEN 1 ELSE 0 END) AS backlog_count
       FROM best b JOIN "students" st ON st."id" = b."student_id"
       WHERE b.rn = 1
       GROUP BY b."student_id", st."student_id", st."display_name"
       ORDER BY st."student_id"`,
      [uploadSession, batchId],
    );

    const semRows = await this.dataSource.query(
      `${bestCte}
       SELECT "student_id" AS student_id, "semester" AS semester,
              COALESCE(ROUND(SUM("credits" * "grade_points") / NULLIF(SUM("credits"), 0), 2), 0) AS sgpa,
              SUM("credits") AS total_credits, COUNT(*) AS subjects_count,
              SUM(CASE WHEN "grade" = 'F' THEN 0 ELSE 1 END) AS passed_count,
              SUM(CASE WHEN "grade" = 'F' THEN 1 ELSE 0 END) AS backlog_count
       FROM best WHERE rn = 1
       GROUP BY "student_id", "semester"
       ORDER BY "student_id", "semester"`,
      [uploadSession, batchId],
    );

    const semBy = new Map<number, SemesterSummary[]>();
    for (const r of semRows) {
      const sid = Number(r.student_id);
      const list = semBy.get(sid) ?? [];
      const backlog = Number(r.backlog_count);
      list.push({
        semester: Number(r.semester),
        sgpa: Number(r.sgpa),
        total_credits: Number(r.total_credits),
        subjects_count: Number(r.subjects_count),
        passed_count: Number(r.passed_count),
        backlog_count: backlog,
        passed: backlog === 0,
      });
      semBy.set(sid, list);
    }

    return cgpaRows.map((c) => ({
      student_id: Number(c.student_id),
      roll_number: c.roll_number,
      name: c.name,
      cgpa: Number(c.cgpa),
      total_credits: Number(c.total_credits),
      backlog_count: Number(c.backlog_count),
      semesters_count: Number(c.semesters_count),
      semesters: semBy.get(Number(c.student_id)) ?? [],
    }));
  }

  /** Resolve batch + scope, returning the batch. */
  private async assertBatchExistsInScope(
    employeeId: number,
    programmeAdmissionYearId: number,
  ): Promise<ProgrammeAdmissionYear> {
    await this.assertBatchInScope(employeeId, programmeAdmissionYearId);
    const batch = await this.batches.findOne({
      where: { id: programmeAdmissionYearId },
    });
    if (!batch) throw new ForbiddenException('Access denied');
    return batch;
  }

  /** Build the roll → {id, name} roster map for the given rolls within a batch. */
  private async rosterFor(
    batch: ProgrammeAdmissionYear,
    rolls: string[],
  ): Promise<Map<string, { id: number; name: string }>> {
    if (rolls.length === 0) return new Map();
    const roster = await this.students.find({
      where: {
        programme_id: batch.programme_id,
        admission_year_id: batch.admission_year_id,
        is_active: true,
      },
      select: { id: true, student_id: true, display_name: true },
    });
    return new Map(
      roster.map((s) => [s.student_id, { id: s.id, name: s.display_name }]),
    );
  }

  /** Throw unless the employee is scoped to the batch (three-state contract). */
  private async assertBatchInScope(
    employeeId: number,
    programmeAdmissionYearId: number,
    screenKey: string = SCREEN_KEY,
  ): Promise<void> {
    const accessible =
      await this.permissions.getAccessibleProgrammeAdmissionYearIds(
        employeeId,
        screenKey,
      );
    const inScope =
      accessible === ACCESS_ALL ||
      accessible.includes(programmeAdmissionYearId);
    if (!inScope) throw new ForbiddenException('Access denied');
  }

  /**
   * Validate + parse one row into staging fields. All grading rules (legal
   * grade, grade→points, examination→semester) are applied here, server-side.
   * Returns the parsed fields (best-effort) plus any per-cell errors; the first
   * error is also stamped on the staging row to block commit.
   */
  private buildStagingRow(
    row: UploadMarksRow,
    meta: Map<string, { id: number; name: string }>,
  ): {
    fields: Partial<StudentExamResultStaging>;
    errors: Array<{ column: string; value: string; reason: string }>;
  } {
    const errors: Array<{ column: string; value: string; reason: string }> = [];
    const err = (column: string, value: string, reason: string) =>
      errors.push({ column, value, reason });

    const parsed = parseExamination(row.examination);
    if (!parsed) {
      err(
        'examination',
        row.examination,
        'Unrecognised examination (e.g. "II YEAR I SEMESTER Regular")',
      );
    }

    const examDate = normaliseDate(row.exam_date);
    if (!examDate) err('exam_date', row.exam_date, 'Not a valid date');

    const roll = row.roll_number.trim();
    const studentMeta = meta.get(roll);
    if (!roll) err('roll_number', row.roll_number, 'HT No is required');
    else if (!studentMeta)
      err(
        'roll_number',
        row.roll_number,
        'No active student with this HT No in the batch',
      );

    const subjectCode = row.subject_code.trim();
    const subjectName = row.subject_name.trim();
    if (!subjectCode) err('subject_code', row.subject_code, 'Sub Code is required');
    if (!subjectName) err('subject_name', row.subject_name, 'Sub Name is required');

    const credits = Number(row.credits);
    const creditsOk =
      row.credits.trim() !== '' && Number.isFinite(credits) && credits >= 0;
    if (!creditsOk) err('credits', row.credits, 'Credits must be a number ≥ 0');

    const grade = row.grade.trim().toUpperCase();
    const gradeValid = (GRADES as readonly string[]).includes(grade);
    if (!gradeValid)
      err('grade', row.grade, `Grade must be one of ${GRADES.join(', ')}`);

    const gp = Number(row.grade_points);
    if (row.grade_points.trim() === '' || !Number.isFinite(gp)) {
      err('grade_points', row.grade_points, 'Grade Points must be a number');
    } else if (gradeValid && gp !== GRADE_POINT_MAP[grade as Grade]) {
      err(
        'grade_points',
        row.grade_points,
        `Grade Points for "${grade}" must be ${GRADE_POINT_MAP[grade as Grade]}`,
      );
    }

    const first = errors[0];
    return {
      fields: {
        examination: row.examination.trim().slice(0, 64),
        exam_date: examDate,
        roll_number: roll.slice(0, 32),
        subject_code: subjectCode.slice(0, 32),
        subject_name: subjectName.slice(0, 128),
        credits: creditsOk ? credits.toFixed(1) : null,
        grade: grade.slice(0, 8),
        // Store the canonical grade point (server-owned mapping), not the sheet value.
        grade_points: gradeValid
          ? GRADE_POINT_MAP[grade as Grade].toFixed(1)
          : null,
        semester: parsed?.semester ?? null,
        exam_type: parsed?.exam_type ?? null,
        student_id: studentMeta?.id ?? null,
        error_column: first?.column ?? null,
        error_reason: first?.reason ?? null,
      },
      errors,
    };
  }

  /**
   * Group one student's rows, pick the best attempt per (semester, subject) —
   * highest grade_points, tie-break latest exam_date — and compute the
   * student-wise detail (semesters → subjects → attempts) for the preview
   * drill-down. Used only for the on-demand single-student detail now; commit
   * aggregates in SQL.
   */
  private computeBatch(
    rows: NormRow[],
    meta: Map<string, { id: number; name: string }>,
  ): ComputedStudent[] {
    const byStudent = new Map<number, NormRow[]>();
    for (const r of rows) {
      const list = byStudent.get(r.studentId) ?? [];
      list.push(r);
      byStudent.set(r.studentId, list);
    }

    const nameById = new Map<number, { roll_number: string; name: string }>();
    for (const [roll, m] of meta)
      nameById.set(m.id, { roll_number: roll, name: m.name });

    const out: ComputedStudent[] = [];
    for (const [studentId, studentRows] of byStudent) {
      const bySemester = new Map<number, Map<string, NormRow[]>>();
      for (const r of studentRows) {
        const sem = bySemester.get(r.semester) ?? new Map<string, NormRow[]>();
        const attempts = sem.get(r.subject_code) ?? [];
        attempts.push(r);
        sem.set(r.subject_code, attempts);
        bySemester.set(r.semester, sem);
      }

      const bestSet = new Set<NormRow>();
      const semesters: PreviewSemester[] = [];
      let cTotalCredits = 0;
      let cCreditPoints = 0;
      let cSubjects = 0;
      let cPassed = 0;
      let cBacklog = 0;

      for (const semNo of [...bySemester.keys()].sort((a, b) => a - b)) {
        const subjects = bySemester.get(semNo)!;
        const previewSubjects: PreviewSubject[] = [];
        let semCredits = 0;
        let semPoints = 0;
        let semPassed = 0;
        let semBacklog = 0;

        for (const code of [...subjects.keys()].sort()) {
          const attempts = subjects.get(code)!;
          const best = pickBest(attempts);
          bestSet.add(best);

          semCredits += best.credits;
          semPoints += best.credits * best.grade_points;
          if (best.grade === 'F') semBacklog += 1;
          else semPassed += 1;

          const attemptsDetail: AttemptDetail[] = attempts
            .slice()
            .sort((a, b) => (a.exam_date < b.exam_date ? -1 : 1))
            .map((a) => ({
              exam_type: a.exam_type,
              exam_date: a.exam_date,
              credits: a.credits,
              grade: a.grade,
              grade_points: a.grade_points,
              grade_meaning: GRADE_MEANING_MAP[a.grade as Grade] ?? '',
              is_best: a === best,
            }));

          previewSubjects.push({
            subject_code: best.subject_code,
            subject_name: best.subject_name,
            credits: best.credits,
            grade: best.grade,
            grade_points: best.grade_points,
            grade_meaning: GRADE_MEANING_MAP[best.grade as Grade] ?? '',
            exam_type: best.exam_type,
            exam_date: best.exam_date,
            attempts: attempts.length,
            attempts_detail: attemptsDetail,
          });
        }

        const sgpa = semCredits > 0 ? round2(semPoints / semCredits) : 0;
        semesters.push({
          semester: semNo,
          sgpa,
          total_credits: round2(semCredits),
          credit_points: round2(semPoints),
          subjects_count: previewSubjects.length,
          passed_count: semPassed,
          backlog_count: semBacklog,
          passed: semBacklog === 0,
          subjects: previewSubjects,
        });

        cTotalCredits += semCredits;
        cCreditPoints += semPoints;
        cSubjects += previewSubjects.length;
        cPassed += semPassed;
        cBacklog += semBacklog;
      }

      const info = nameById.get(studentId) ?? { roll_number: '', name: '' };
      out.push({
        student_id: studentId,
        roll_number: info.roll_number,
        name: info.name,
        cgpa: cTotalCredits > 0 ? round2(cCreditPoints / cTotalCredits) : 0,
        total_credits: round2(cTotalCredits),
        credit_points: round2(cCreditPoints),
        semesters_count: semesters.length,
        subjects_count: cSubjects,
        passed_count: cPassed,
        backlog_count: cBacklog,
        semesters,
        rows: studentRows.map((r) => ({ ...r, is_best: bestSet.has(r) })),
      });
    }

    return out;
  }
}

/** Highest grade_points wins; ties broken by the latest exam_date. */
function pickBest(attempts: NormRow[]): NormRow {
  return attempts.reduce((best, r) => {
    if (r.grade_points > best.grade_points) return r;
    if (r.grade_points === best.grade_points && r.exam_date > best.exam_date)
      return r;
    return best;
  });
}

/** Accept an ISO date (YYYY-MM-DD); return it normalised, or null if invalid. */
function normaliseDate(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

/** Drop the internal-only fields before returning a student to the client. */
function stripInternal(s: ComputedStudent): PreviewStudent {
  return {
    student_id: s.student_id,
    roll_number: s.roll_number,
    name: s.name,
    cgpa: s.cgpa,
    total_credits: s.total_credits,
    backlog_count: s.backlog_count,
    semesters_count: s.semesters_count,
    semesters: s.semesters,
  };
}

/** Bulk insert in chunks to keep parameter counts under Postgres limits. */
async function insertChunked<T extends object>(
  repo: Repository<T>,
  rows: Partial<T>[],
  size = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    if (chunk.length > 0) {
      await repo.insert(chunk as T[]);
    }
  }
}
