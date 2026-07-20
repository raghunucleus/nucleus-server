import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GuardianSyncService } from '../../guardian/guardian-sync.service';
import { StudentAuthService } from '../../student/student-auth.service';
import {
  ResumeView,
  StudentResumeService,
} from '../../student/profile/student-resume.service';
import { StorageService } from '../../storage/storage.service';
import { storageKey } from '../../storage/storage.constants';
import type { StudentsSortField } from '../dto/list-students.dto';
import { AdmissionYear } from '../entities/admission-year.entity';
import { Country } from '../entities/country.entity';
import { DiplomaBoard } from '../entities/diploma-board.entity';
import { District } from '../entities/district.entity';
import { EntranceExam } from '../entities/entrance-exam.entity';
import { IndustryCertification } from '../entities/industry-certification.entity';
import { Programme } from '../entities/programme.entity';
import { ProgrammeAdmissionYear } from '../entities/programme-admission-year.entity';
import { SchoolBoardX } from '../entities/school-board-x.entity';
import { SchoolBoardXii } from '../entities/school-board-xii.entity';
import { State } from '../entities/state.entity';
import { Student } from '../entities/student.entity';
import { StudentIndustryCertification } from '../entities/student-industry-certification.entity';

export interface BulkRowError {
  rowIndex: number;
  field?: string;
  message: string;
}

export interface BulkCreateStudentRow {
  student_id: string;
  display_name: string;
  gender: string;
  entry_type: number;
  dob: string;
  blood_group: string | null;
  abc_id: string | null;
  mobile_number: string;
  email: string;
}

export interface ListStudentsResult {
  rows: Student[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

const SORT_COLUMN: Record<StudentsSortField, string> = {
  student_id: 'student_id',
  display_name: 'display_name',
  gender: 'gender',
  mobile_number: 'mobile_number',
  email: 'email',
  abc_id: 'abc_id',
  dob: 'dob',
  status: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

// Allowed ID-card photo types → file extension used in the object key.
const PHOTO_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface CreateStudentInput {
  student_id: string;
  programme_id: number;
  admission_year_id: number;
  display_name: string;
  gender: string;
  entry_type: number;
  dob: string;
  blood_group: string | null;
  abc_id: string | null;
  mobile_number: string;
  email: string;
}

interface UpdateStudentInput {
  student_id?: string;
  programme_id?: number;
  admission_year_id?: number;
  display_name?: string;
  gender?: string;
  entry_type?: number;
  dob?: string;
  blood_group?: string | null;
  abc_id?: string | null;
  mobile_number?: string;
  email?: string;
  // Extended profile — admins edit any field directly, including the ones
  // students can't touch (AUTO / SYSTEM_LOCKED / ADMIN_ONLY policies).
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  personal_email?: string | null;
  pass_out_year?: number | null;
  tenth_percentage?: number | null;
  twelfth_percentage?: number | null;
  diploma_percentage?: number | null;
  ug_cgpa?: number | null;
  current_backlogs?: number | null;
  backlog_history?: boolean;
  parent_name?: string | null;
  parent_mobile?: string | null;
  parent_email?: string | null;
  guardian_name?: string | null;
  guardian_mobile?: string | null;
  guardian_email?: string | null;
  home_address?: string | null;
  home_district_id?: number | null;
  home_pincode?: string | null;
  home_state_id?: number | null;
  home_country_id?: number | null;
  aadhaar_number?: string | null;
  pan_number?: string | null;
  entrance_exam_na?: boolean;
  entrance_exam_id?: number | null;
  entrance_exam_rank?: number | null;
  entrance_exam_year?: number | null;
  year_of_gap?: number | null;
  reason_of_gap?: string | null;
  tenth_board_id?: number | null;
  tenth_institution?: string | null;
  tenth_year_of_pass?: number | null;
  tenth_state_id?: number | null;
  twelfth_board_id?: number | null;
  twelfth_institution?: string | null;
  twelfth_year_of_pass?: number | null;
  twelfth_state_id?: number | null;
  diploma_board_id?: number | null;
  diploma_institution?: string | null;
  diploma_year_of_pass?: number | null;
  diploma_specialization?: string | null;
  diploma_state_id?: number | null;
  allowed_by_dept_for_placements?: boolean | null;
  interested_in_placements_self?: boolean | null;
}

/** Extended-profile columns that copy from the patch verbatim (after checks). */
const DIRECT_PATCH_KEYS = [
  'first_name',
  'middle_name',
  'last_name',
  'pass_out_year',
  'tenth_percentage',
  'twelfth_percentage',
  'diploma_percentage',
  'ug_cgpa',
  'current_backlogs',
  'backlog_history',
  'parent_name',
  'parent_mobile',
  'parent_email',
  'guardian_name',
  'guardian_mobile',
  'guardian_email',
  'home_address',
  'home_district_id',
  'home_pincode',
  'home_state_id',
  'home_country_id',
  'aadhaar_number',
  'pan_number',
  'year_of_gap',
  'reason_of_gap',
  'tenth_board_id',
  'tenth_institution',
  'tenth_year_of_pass',
  'tenth_state_id',
  'twelfth_board_id',
  'twelfth_institution',
  'twelfth_year_of_pass',
  'twelfth_state_id',
  'diploma_board_id',
  'diploma_institution',
  'diploma_year_of_pass',
  'diploma_specialization',
  'diploma_state_id',
  'allowed_by_dept_for_placements',
  'interested_in_placements_self',
] as const;

const GUARDIAN_FLAT_KEYS = [
  'parent_name',
  'parent_mobile',
  'parent_email',
  'guardian_name',
  'guardian_mobile',
  'guardian_email',
] as const;

/** Lookup FK columns → entity + human label, for reference validation. */
const LOOKUP_FK_DEFS: Array<{
  key: keyof UpdateStudentInput;
  entity: new () => { id: number };
  label: string;
}> = [
  { key: 'home_district_id', entity: District, label: 'District' },
  { key: 'home_state_id', entity: State, label: 'State' },
  { key: 'home_country_id', entity: Country, label: 'Country' },
  { key: 'entrance_exam_id', entity: EntranceExam, label: 'Entrance exam' },
  { key: 'tenth_board_id', entity: SchoolBoardX, label: '10th board' },
  { key: 'tenth_state_id', entity: State, label: '10th state' },
  { key: 'twelfth_board_id', entity: SchoolBoardXii, label: '12th board' },
  { key: 'twelfth_state_id', entity: State, label: '12th state' },
  { key: 'diploma_board_id', entity: DiplomaBoard, label: 'Diploma board' },
  { key: 'diploma_state_id', entity: State, label: 'Diploma state' },
];

export interface AdminStudentCertification {
  id: number;
  industry_certification_id: number;
  name: string;
  certificate_file_url: string | null;
  created_at: Date;
}

// Allowed certificate types → file extension used in the object key.
const CERTIFICATE_EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

@Injectable()
export class StudentsService {
  constructor(
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectRepository(Programme)
    private readonly programmes: Repository<Programme>,
    @InjectRepository(AdmissionYear)
    private readonly admissionYears: Repository<AdmissionYear>,
    @InjectRepository(ProgrammeAdmissionYear)
    private readonly programmeAdmissionYears: Repository<ProgrammeAdmissionYear>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly studentAuth: StudentAuthService,
    private readonly storage: StorageService,
    private readonly guardianSync: GuardianSyncService,
    private readonly resumes: StudentResumeService,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: StudentsSortField;
    sortOrder: 'asc' | 'desc';
    studentIdSearch?: string;
    displayNameSearch?: string;
    emailSearch?: string;
    mobileSearch?: string;
    abcIdSearch?: string;
    status?: 'active' | 'inactive';
    gender?: string;
    entryType?: number;
    bloodGroup?: string;
    programmeId?: number;
    admissionYearId?: number;
  }): Promise<ListStudentsResult> {
    const qb = this.students
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.programme', 'programme')
      .leftJoinAndSelect('s.admission_year', 'admission_year');

    if (opts.studentIdSearch) {
      qb.andWhere('LOWER(s.student_id) LIKE :sid', {
        sid: `%${opts.studentIdSearch.toLowerCase()}%`,
      });
    }

    if (opts.displayNameSearch) {
      qb.andWhere('LOWER(s.display_name) LIKE :dn', {
        dn: `%${opts.displayNameSearch.toLowerCase()}%`,
      });
    }

    if (opts.emailSearch) {
      qb.andWhere('LOWER(s.email) LIKE :em', {
        em: `%${opts.emailSearch.toLowerCase()}%`,
      });
    }

    if (opts.mobileSearch) {
      qb.andWhere('s.mobile_number LIKE :mb', {
        mb: `%${opts.mobileSearch}%`,
      });
    }

    if (opts.abcIdSearch) {
      qb.andWhere('s.abc_id LIKE :abc', { abc: `%${opts.abcIdSearch}%` });
    }

    if (opts.status === 'active') {
      qb.andWhere('s.is_active = TRUE');
    } else if (opts.status === 'inactive') {
      qb.andWhere('s.is_active = FALSE');
    }

    if (opts.gender) qb.andWhere('s.gender = :g', { g: opts.gender });
    if (opts.entryType)
      qb.andWhere('s.entry_type = :et', { et: opts.entryType });
    if (opts.bloodGroup)
      qb.andWhere('s.blood_group = :bg', { bg: opts.bloodGroup });
    if (opts.programmeId)
      qb.andWhere('s.programme_id = :pi', { pi: opts.programmeId });
    if (opts.admissionYearId)
      qb.andWhere('s.admission_year_id = :ai', { ai: opts.admissionYearId });

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(`s.${SORT_COLUMN[opts.sortBy]}`, direction, 'NULLS LAST')
      .addOrderBy('s.id', 'ASC')
      .skip((opts.page - 1) * opts.pageSize)
      .take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();
    return {
      rows,
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
    };
  }

  async getOne(id: number): Promise<Student> {
    const student = await this.students.findOne({
      where: { id },
      // The extended-profile lookups are non-eager (they'd bloat every student
      // query); the detail view is the one place their names are wanted.
      relations: {
        home_district: true,
        home_state: true,
        home_country: true,
        entrance_exam: true,
        tenth_board: true,
        tenth_state: true,
        twelfth_board: true,
        twelfth_state: true,
        diploma_board: true,
        diploma_state: true,
      },
    });
    if (!student) throw new NotFoundException('Student not found');
    // The resume link rides along as a plain column (resume_external_url).
    return student;
  }

  async create(input: CreateStudentInput): Promise<Student> {
    await this.assertReferencesExist({
      programme_id: input.programme_id,
      admission_year_id: input.admission_year_id,
    });

    await this.assertUnique({
      student_id: input.student_id,
      email: input.email,
      abc_id: input.abc_id,
    });

    const student = this.students.create({
      student_id: input.student_id,
      programme_id: input.programme_id,
      admission_year_id: input.admission_year_id,
      display_name: input.display_name,
      gender: input.gender,
      entry_type: input.entry_type,
      dob: input.dob,
      blood_group: input.blood_group,
      abc_id: input.abc_id,
      mobile_number: input.mobile_number,
      email: input.email,
      is_active: true,
      pass_out_year: await this.computePassOutYear(
        input.programme_id,
        input.admission_year_id,
      ),
    });
    return this.students.save(student);
  }

  async update(id: number, patch: UpdateStudentInput): Promise<Student> {
    const student = await this.students.findOne({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');

    await this.assertReferencesExist({
      programme_id:
        patch.programme_id !== undefined &&
        patch.programme_id !== student.programme_id
          ? patch.programme_id
          : undefined,
      admission_year_id:
        patch.admission_year_id !== undefined &&
        patch.admission_year_id !== student.admission_year_id
          ? patch.admission_year_id
          : undefined,
    });
    await this.assertLookupReferencesExist(patch);

    // Aadhaar is unique per (programme, aadhaar). Check whenever the value OR
    // the programme changes — moving a student into a programme where that
    // aadhaar already exists must 409 too. Scope = the TARGET programme.
    const targetProgrammeId = patch.programme_id ?? student.programme_id;
    const programmeMoves =
      patch.programme_id !== undefined &&
      patch.programme_id !== student.programme_id;
    const aadhaarToCheck =
      patch.aadhaar_number !== undefined &&
      patch.aadhaar_number !== student.aadhaar_number
        ? patch.aadhaar_number
        : programmeMoves
          ? student.aadhaar_number
          : undefined;

    await this.assertUnique({
      student_id:
        patch.student_id !== undefined &&
        patch.student_id !== student.student_id
          ? patch.student_id
          : undefined,
      email:
        patch.email !== undefined && patch.email !== student.email
          ? patch.email
          : undefined,
      abc_id:
        patch.abc_id !== undefined && patch.abc_id !== student.abc_id
          ? patch.abc_id
          : undefined,
      aadhaar_number: aadhaarToCheck,
      aadhaar_programme_id: targetProgrammeId,
      excludeId: id,
    });

    // Column patch — built explicitly, applied with a partial update() so the
    // eager relations never clobber. `undefined` = leave untouched.
    const changes: Partial<Record<keyof Student, unknown>> = {};
    if (patch.student_id !== undefined) changes.student_id = patch.student_id;
    if (patch.programme_id !== undefined)
      changes.programme_id = patch.programme_id;
    if (patch.admission_year_id !== undefined)
      changes.admission_year_id = patch.admission_year_id;
    if (patch.display_name !== undefined)
      changes.display_name = patch.display_name;
    if (patch.gender !== undefined) changes.gender = patch.gender;
    if (patch.entry_type !== undefined) changes.entry_type = patch.entry_type;
    if (patch.dob !== undefined) changes.dob = patch.dob;
    if (patch.blood_group !== undefined)
      changes.blood_group = patch.blood_group;
    if (patch.abc_id !== undefined) changes.abc_id = patch.abc_id;
    if (patch.mobile_number !== undefined)
      changes.mobile_number = patch.mobile_number;
    if (patch.email !== undefined) changes.email = patch.email;

    for (const key of DIRECT_PATCH_KEYS) {
      if (patch[key] !== undefined) changes[key] = patch[key];
    }

    // Admin sets the personal email directly — any in-flight OTP verification
    // is for a now-superseded address, so the staged value dies with it.
    if (patch.personal_email !== undefined) {
      changes.personal_email = patch.personal_email;
      changes.personal_email_pending = null;
    }

    // Entrance na-invariant: marking N/A clears the trio (the DTO already
    // rejects a patch that sets na=true alongside values).
    if (patch.entrance_exam_na !== undefined) {
      changes.entrance_exam_na = patch.entrance_exam_na;
      if (patch.entrance_exam_na) {
        changes.entrance_exam_id = null;
        changes.entrance_exam_rank = null;
        changes.entrance_exam_year = null;
      }
    }
    if (patch.entrance_exam_id !== undefined && !patch.entrance_exam_na) {
      changes.entrance_exam_id = patch.entrance_exam_id;
      if (patch.entrance_exam_id !== null) changes.entrance_exam_na = false;
    }
    if (patch.entrance_exam_rank !== undefined && !patch.entrance_exam_na) {
      changes.entrance_exam_rank = patch.entrance_exam_rank;
    }
    if (patch.entrance_exam_year !== undefined && !patch.entrance_exam_na) {
      changes.entrance_exam_year = patch.entrance_exam_year;
    }

    // A zero-year gap has no reason.
    if (patch.year_of_gap === 0 || patch.year_of_gap === null) {
      if (patch.reason_of_gap === undefined) changes.reason_of_gap = null;
    }

    // Keep the cached pass-out year honest when the batch moves — unless the
    // admin explicitly set it in the same patch.
    const programmeChanged =
      patch.programme_id !== undefined &&
      patch.programme_id !== student.programme_id;
    const yearChanged =
      patch.admission_year_id !== undefined &&
      patch.admission_year_id !== student.admission_year_id;
    if (
      (programmeChanged || yearChanged) &&
      patch.pass_out_year === undefined
    ) {
      changes.pass_out_year = await this.computePassOutYear(
        patch.programme_id ?? student.programme_id,
        patch.admission_year_id ?? student.admission_year_id,
      );
    }

    const guardianTouched = GUARDIAN_FLAT_KEYS.some(
      (k) => patch[k] !== undefined,
    );

    const stale = await this.dataSource.transaction(async (tx) => {
      if (Object.keys(changes).length > 0) {
        await tx
          .getRepository(Student)
          .update(
            { id },
            changes as Parameters<Repository<Student>['update']>[1],
          );
      }
      // Mirror the flat contacts into the two fixed student_guardians rows.
      return guardianTouched
        ? this.guardianSync.syncFromFlatFields(tx, id)
        : [];
    });
    if (stale.length > 0) void this.guardianSync.revokeStaleMobiles(stale);

    return this.getOne(id);
  }

  /**
   * Insert a batch of students for a single (programme, admission year) pair.
   * The combination must exist as an active row in programme_admission_years
   * — that's what the bulk-upload matrix gates on, and re-checking server-side
   * keeps a stale UI from inserting students into a deactivated batch.
   *
   * Validation runs entirely up front and returns 400 with per-row errors;
   * the actual insert only happens once every row is clean, inside a single
   * transaction so the upload is all-or-nothing.
   */
  async bulkCreate(
    programmeId: number,
    admissionYearId: number,
    rows: BulkCreateStudentRow[],
  ): Promise<{ created: number }> {
    if (rows.length === 0) return { created: 0 };

    const pay = await this.programmeAdmissionYears.findOne({
      where: {
        programme_id: programmeId,
        admission_year_id: admissionYearId,
      },
    });
    if (!pay) {
      throw new BadRequestException(
        'This programme is not configured for the selected admission year',
      );
    }
    if (!pay.is_active) {
      throw new BadRequestException(
        'The selected programme + admission year is deactivated',
      );
    }

    const errors: BulkRowError[] = [];

    // 1. Intra-batch duplicates.
    seenAt(rows, (r) => r.student_id.toUpperCase()).forEach((indices, key) => {
      if (indices.length > 1) {
        for (const i of indices) {
          errors.push({
            rowIndex: i,
            field: 'student_id',
            message: `Duplicate student_id "${key}" in batch (rows ${indices.map((n) => n + 1).join(', ')})`,
          });
        }
      }
    });

    seenAt(rows, (r) => r.email.toLowerCase()).forEach((indices, key) => {
      if (indices.length > 1) {
        for (const i of indices) {
          errors.push({
            rowIndex: i,
            field: 'email',
            message: `Duplicate email "${key}" in batch (rows ${indices.map((n) => n + 1).join(', ')})`,
          });
        }
      }
    });

    // abc_id is optional — only check intra-batch dupes for non-null values.
    const abcRowsByValue = new Map<string, number[]>();
    rows.forEach((r, i) => {
      if (r.abc_id) {
        const list = abcRowsByValue.get(r.abc_id) ?? [];
        list.push(i);
        abcRowsByValue.set(r.abc_id, list);
      }
    });
    abcRowsByValue.forEach((indices, key) => {
      if (indices.length > 1) {
        for (const i of indices) {
          errors.push({
            rowIndex: i,
            field: 'abc_id',
            message: `Duplicate ABC ID "${key}" in batch (rows ${indices.map((n) => n + 1).join(', ')})`,
          });
        }
      }
    });

    // 2. Conflicts with existing students in the DB.
    const studentIds = rows.map((r) => r.student_id);
    const emails = rows.map((r) => r.email.toLowerCase());
    const abcIds = rows.map((r) => r.abc_id).filter((v): v is string => !!v);

    const [existingByStudentIdRows, existingByEmailRows, existingByAbcIdRows] =
      await Promise.all([
        this.students
          .createQueryBuilder('s')
          .select(['s.student_id'])
          .where('s.student_id IN (:...ids)', { ids: studentIds })
          .getMany(),
        this.students
          .createQueryBuilder('s')
          .select(['s.email'])
          .where('LOWER(s.email) IN (:...emails)', { emails })
          .getMany(),
        abcIds.length === 0
          ? Promise.resolve([])
          : this.students
              .createQueryBuilder('s')
              .select(['s.abc_id'])
              .where('s.abc_id IN (:...abcIds)', { abcIds })
              .getMany(),
      ]);

    const existingByStudentId = new Set(
      existingByStudentIdRows.map((s) => s.student_id.toUpperCase()),
    );
    const existingByEmail = new Set(
      existingByEmailRows.map((s) => s.email.toLowerCase()),
    );
    const existingByAbcId = new Set(
      existingByAbcIdRows.map((s) => s.abc_id).filter((v): v is string => !!v),
    );

    rows.forEach((r, i) => {
      if (existingByStudentId.has(r.student_id.toUpperCase())) {
        errors.push({
          rowIndex: i,
          field: 'student_id',
          message: `student_id "${r.student_id}" already exists`,
        });
      }
      if (existingByEmail.has(r.email.toLowerCase())) {
        errors.push({
          rowIndex: i,
          field: 'email',
          message: `email "${r.email}" already exists`,
        });
      }
      if (r.abc_id && existingByAbcId.has(r.abc_id)) {
        errors.push({
          rowIndex: i,
          field: 'abc_id',
          message: `ABC ID "${r.abc_id}" already exists`,
        });
      }
    });

    if (errors.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Bulk validation failed',
        rowErrors: errors,
      });
    }

    // One batch = one (programme, admission year), so one computation covers
    // every row. The bulk field contract itself is untouched (still 9 fields).
    const passOutYear = await this.computePassOutYear(
      programmeId,
      admissionYearId,
    );

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Student);
      const entities = rows.map((r) =>
        repo.create({
          student_id: r.student_id,
          programme_id: programmeId,
          admission_year_id: admissionYearId,
          display_name: r.display_name,
          gender: r.gender,
          entry_type: r.entry_type,
          dob: r.dob,
          blood_group: r.blood_group,
          abc_id: r.abc_id,
          mobile_number: r.mobile_number,
          email: r.email,
          is_active: true,
          pass_out_year: passOutYear,
        }),
      );
      const saved = await repo.save(entities);
      return { created: saved.length };
    });
  }

  /**
   * Cached pass-out year = admission year + degree duration. Lateral entrants
   * graduate with their batch (the +1 in displayedAdmissionYear is view-only),
   * so entry_type never enters this. Null when the degree has no duration.
   */
  private async computePassOutYear(
    programmeId: number,
    admissionYearId: number,
  ): Promise<number | null> {
    const [programme, year] = await Promise.all([
      this.programmes.findOne({
        where: { id: programmeId },
        relations: { degree: true },
      }),
      this.admissionYears.findOne({ where: { id: admissionYearId } }),
    ]);
    const duration = programme?.degree?.duration_years;
    if (!duration || !year) return null;
    return year.year + duration;
  }

  /**
   * Returns every student_id in the table. Used by bulk-upload clients that
   * want to do their own up-front collision detection.
   */
  async listStudentIds(): Promise<string[]> {
    const rows = await this.students
      .createQueryBuilder('s')
      .select('s.student_id', 'student_id')
      .getRawMany<{ student_id: string }>();
    return rows.map((r) => r.student_id);
  }

  /**
   * Provision (or reset) the student's login: generates a random temporary
   * password, emails it to their registered address, forces a change on first
   * login, and revokes any sessions the account currently holds. Used both for
   * the very first invite and for "reset password" later.
   */
  async resetLoginPassword(id: number): Promise<{ email: string }> {
    const student = await this.students.findOne({
      where: { id },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    return this.studentAuth.adminResetPassword(id);
  }

  /**
   * Directly set the student's login password to an admin-chosen value. No
   * email is sent; the student is still forced to change it on first sign-in.
   */
  async setLoginPassword(id: number, password: string): Promise<void> {
    const student = await this.students.findOne({
      where: { id },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');
    await this.studentAuth.adminSetPassword(id, password);
  }

  async setActive(id: number, active: boolean): Promise<Student> {
    const student = await this.students.findOne({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');

    if (student.is_active === active) return student;

    student.is_active = active;
    return this.students.save(student);
  }

  /**
   * Store (or replace) the student's ID-card photo in object storage. The key
   * is a random UUID — never the roll number — so it can't be guessed from any
   * public identifier. The previous object, if any, is deleted afterwards as
   * best-effort cleanup.
   */
  async setPhoto(
    id: number,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<Student> {
    const student = await this.students.findOne({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');

    const ext = PHOTO_EXT_BY_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Unsupported image type. Use JPEG, PNG, or WebP.',
      );
    }

    const previousKey = student.photo_key;
    const key = storageKey.studentPhoto(ext);
    await this.storage.putObject(key, file.buffer, file.mimetype);

    student.photo_key = key;
    const saved = await this.students.save(student);

    if (previousKey && previousKey !== key) {
      await this.storage.deleteObject(previousKey);
    }
    return saved;
  }

  /** Remove the student's ID-card photo (object + reference). */
  async removePhoto(id: number): Promise<Student> {
    const student = await this.students.findOne({ where: { id } });
    if (!student) throw new NotFoundException('Student not found');

    const key = student.photo_key;
    if (!key) return student;

    student.photo_key = null;
    const saved = await this.students.save(student);
    await this.storage.deleteObject(key);
    return saved;
  }

  private async assertReferencesExist(opts: {
    programme_id?: number;
    admission_year_id?: number;
  }): Promise<void> {
    if (opts.programme_id !== undefined) {
      const programme = await this.programmes.findOne({
        where: { id: opts.programme_id },
        select: { id: true },
      });
      if (!programme) throw new BadRequestException('Programme not found');
    }

    if (opts.admission_year_id !== undefined) {
      const year = await this.admissionYears.findOne({
        where: { id: opts.admission_year_id },
        select: { id: true },
      });
      if (!year) throw new BadRequestException('Admission year not found');
    }
  }

  /** 400 on any lookup FK in the patch that doesn't reference a real row. */
  private async assertLookupReferencesExist(
    patch: UpdateStudentInput,
  ): Promise<void> {
    for (const { key, entity, label } of LOOKUP_FK_DEFS) {
      const value = patch[key];
      if (value === undefined || value === null) continue;
      const exists = await this.students.manager
        .getRepository(entity)
        .exists({ where: { id: Number(value) } });
      if (!exists) throw new BadRequestException(`${label} not found`);
    }
  }

  // ---------------------------------------------------------------------------
  // Certifications + resume (admin side — direct, no approvals)
  // ---------------------------------------------------------------------------

  async listCertifications(id: number): Promise<AdminStudentCertification[]> {
    await this.getOne(id);
    const rows = await this.students.manager
      .getRepository(StudentIndustryCertification)
      .find({
        where: { student_id: id },
        relations: { industry_certification: true },
        order: { id: 'ASC' },
      });
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        industry_certification_id: r.industry_certification_id,
        name: r.industry_certification?.name ?? '—',
        certificate_file_url: r.certificate_file_key
          ? await this.storage
              .getCachedReadUrl(r.certificate_file_key)
              .catch(() => null)
          : null,
        created_at: r.created_at,
      })),
    );
  }

  async addCertification(
    id: number,
    certificationId: number,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<AdminStudentCertification[]> {
    await this.getOne(id);

    const cert = await this.students.manager
      .getRepository(IndustryCertification)
      .findOne({ where: { id: certificationId } });
    if (!cert) throw new BadRequestException('Certification not found');

    const repo = this.students.manager.getRepository(
      StudentIndustryCertification,
    );
    const already = await repo.exists({
      where: { student_id: id, industry_certification_id: certificationId },
    });
    if (already) {
      throw new ConflictException(`This student already holds ${cert.name}.`);
    }

    const ext = CERTIFICATE_EXT_BY_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        'Unsupported file type. Use PDF, JPEG, or PNG.',
      );
    }
    const key = storageKey.studentCertificate(id, ext);
    await this.storage.putObject(key, file.buffer, file.mimetype);

    await repo.save(
      repo.create({
        student_id: id,
        industry_certification_id: certificationId,
        certificate_file_key: key,
      }),
    );
    return this.listCertifications(id);
  }

  async removeCertification(id: number, rowId: number): Promise<void> {
    const repo = this.students.manager.getRepository(
      StudentIndustryCertification,
    );
    const row = await repo.findOne({ where: { id: rowId, student_id: id } });
    if (!row) throw new NotFoundException('Certification entry not found');
    await repo.remove(row);
    await this.storage.deleteObject(row.certificate_file_key);
  }

  async setResumeExternalUrl(
    id: number,
    url: string | null,
  ): Promise<ResumeView> {
    return this.resumes.setExternalUrl(id, url);
  }

  private async assertUnique(opts: {
    student_id?: string;
    email?: string;
    abc_id?: string | null;
    aadhaar_number?: string | null;
    /** Aadhaar is unique per programme — the TARGET programme to check in. */
    aadhaar_programme_id?: number;
    excludeId?: number;
  }): Promise<void> {
    if (opts.student_id !== undefined) {
      const qb = this.students
        .createQueryBuilder('s')
        .where('LOWER(s.student_id) = LOWER(:v)', { v: opts.student_id });
      if (opts.excludeId) qb.andWhere('s.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Student ID is already in use');
    }

    if (opts.email !== undefined) {
      const qb = this.students
        .createQueryBuilder('s')
        .where('LOWER(s.email) = LOWER(:v)', { v: opts.email });
      if (opts.excludeId) qb.andWhere('s.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('Email is already in use');
    }

    // abc_id is nullable; only check uniqueness when a non-null value is supplied.
    if (opts.abc_id !== undefined && opts.abc_id !== null) {
      const qb = this.students
        .createQueryBuilder('s')
        .where('s.abc_id = :v', { v: opts.abc_id });
      if (opts.excludeId) qb.andWhere('s.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException('ABC ID is already in use');
    }

    // aadhaar_number: nullable, unique per PROGRAMME when present (the same
    // person re-admitted into another programme is a second legitimate row).
    if (opts.aadhaar_number !== undefined && opts.aadhaar_number !== null) {
      const qb = this.students
        .createQueryBuilder('s')
        .where('s.aadhaar_number = :v', { v: opts.aadhaar_number });
      if (opts.aadhaar_programme_id !== undefined) {
        qb.andWhere('s.programme_id = :pid', {
          pid: opts.aadhaar_programme_id,
        });
      }
      if (opts.excludeId) qb.andWhere('s.id != :id', { id: opts.excludeId });
      if (await qb.getOne())
        throw new ConflictException(
          'Aadhaar number is already in use by another student in this programme',
        );
    }
  }
}

function seenAt<T>(
  rows: T[],
  keyFn: (row: T) => string,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  rows.forEach((row, i) => {
    const key = keyFn(row);
    const list = out.get(key) ?? [];
    list.push(i);
    out.set(key, list);
  });
  return out;
}
