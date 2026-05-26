import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { ProgrammeSemesterSubjectsSortField } from '../dto/list-programme-semester-subjects.dto';
import { AttendanceGroup } from '../entities/attendance-group.entity';
import { Employee } from '../entities/employee.entity';
import { ProgrammeAdmissionYear } from '../entities/programme-admission-year.entity';
import { ProgrammeSemester } from '../entities/programme-semester.entity';
import {
  ProgrammeSemesterSubject,
  type ProgrammeSemesterSubjectSlotType,
} from '../entities/programme-semester-subject.entity';
import { ProgrammeSemesterSubjectGroupFaculty } from '../entities/programme-semester-subject-group-faculty.entity';
import { ProgrammeSemesterSubjectOption } from '../entities/programme-semester-subject-option.entity';
import { ProgrammeSemesterSubjectOptionFaculty } from '../entities/programme-semester-subject-option-faculty.entity';
import { ProgrammeSemesterSubjectOptionStudent } from '../entities/programme-semester-subject-option-student.entity';
import { Subject } from '../entities/subject.entity';

export interface ListProgrammeSemesterSubjectsResult {
  rows: ProgrammeSemesterSubject[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

// Payload for the Faculty configuration matrix screen. The client gets back
// the three slices it needs in one round-trip: the real subjects offered in
// the semester (slots are excluded — their faculty is allocated later, in the
// student-allocation flow), the attendance groups for the batch, and the
// existing cell assignments.
export interface FacultyMatrixResult {
  subjects: ProgrammeSemesterSubject[];
  groups: AttendanceGroup[];
  cells: {
    id: number;
    programme_semester_subject_id: number;
    attendance_group_id: number;
    employee_id: number;
    employee: Employee;
  }[];
}

const SORT_COLUMN: Record<ProgrammeSemesterSubjectsSortField, string> = {
  created_at: 'pss.created_at',
  updated_at: 'pss.updated_at',
  credits: 'pss.credits',
  status: 'pss.is_active',
};

interface CreateInput {
  programme_semester_id: number;
  subject_id?: number;
  placeholder_name?: string;
  slot_type?: ProgrammeSemesterSubjectSlotType;
  option_subject_ids?: number[];
  credits: number;
}

interface UpdateInput {
  subject_id?: number | null;
  placeholder_name?: string | null;
  slot_type?: ProgrammeSemesterSubjectSlotType | null;
  credits?: number;
  option_subject_ids?: number[];
}

@Injectable()
export class ProgrammeSemesterSubjectsService {
  constructor(
    @InjectRepository(ProgrammeSemesterSubject)
    private readonly entries: Repository<ProgrammeSemesterSubject>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    @InjectRepository(Subject)
    private readonly subjects: Repository<Subject>,
    @InjectRepository(ProgrammeAdmissionYear)
    private readonly programmeAdmissionYears: Repository<ProgrammeAdmissionYear>,
    @InjectRepository(ProgrammeSemesterSubjectOption)
    private readonly options: Repository<ProgrammeSemesterSubjectOption>,
    @InjectRepository(ProgrammeSemesterSubjectOptionStudent)
    private readonly optionStudents: Repository<ProgrammeSemesterSubjectOptionStudent>,
    @InjectRepository(ProgrammeSemesterSubjectGroupFaculty)
    private readonly groupFaculty: Repository<ProgrammeSemesterSubjectGroupFaculty>,
    @InjectRepository(AttendanceGroup)
    private readonly attendanceGroups: Repository<AttendanceGroup>,
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    private readonly dataSource: DataSource,
  ) {}

  async list(opts: {
    page: number;
    pageSize: number;
    sortBy: ProgrammeSemesterSubjectsSortField;
    sortOrder: 'asc' | 'desc';
    status?: 'active' | 'inactive';
    programmeSemesterId?: number;
    attendanceGroupId?: number;
  }): Promise<ListProgrammeSemesterSubjectsResult> {
    const qb = this.entries
      .createQueryBuilder('pss')
      .leftJoinAndSelect('pss.programme_semester', 'programme_semester')
      .leftJoinAndSelect('pss.subject', 'subject')
      .leftJoinAndSelect('pss.options', 'options')
      .leftJoinAndSelect('options.subject', 'option_subject')
      .leftJoinAndSelect('options.faculty', 'option_faculty')
      .leftJoinAndSelect('option_faculty.employee', 'option_faculty_employee');

    if (opts.status === 'active') qb.andWhere('pss.is_active = TRUE');
    else if (opts.status === 'inactive') qb.andWhere('pss.is_active = FALSE');

    if (opts.programmeSemesterId !== undefined)
      qb.andWhere('pss.programme_semester_id = :psid', {
        psid: opts.programmeSemesterId,
      });

    const direction: 'ASC' | 'DESC' = opts.sortOrder === 'asc' ? 'ASC' : 'DESC';
    qb.orderBy(SORT_COLUMN[opts.sortBy], direction, 'NULLS LAST')
      .addOrderBy('pss.id', 'ASC')
      .addOrderBy('options.id', 'ASC')
      .addOrderBy('option_faculty.id', 'ASC')
      .skip((opts.page - 1) * opts.pageSize)
      .take(opts.pageSize);

    const [rows, total] = await qb.getManyAndCount();

    // When the caller scopes to an attendance group, hydrate each real
    // subject's `faculty` with the single teacher allocated to that
    // (subject, group) cell — empty array when unassigned. Slot rows never
    // carry per-group faculty, so they stay empty too.
    if (opts.attendanceGroupId !== undefined && rows.length > 0) {
      const subjectIds = rows.map((r) => r.id);
      const cells = await this.groupFaculty
        .createQueryBuilder('cell')
        .leftJoinAndSelect('cell.employee', 'employee')
        .where('cell.programme_semester_subject_id IN (:...ids)', {
          ids: subjectIds,
        })
        .andWhere('cell.attendance_group_id = :agid', {
          agid: opts.attendanceGroupId,
        })
        .getMany();
      const bySubject = new Map<number, ProgrammeSemesterSubjectGroupFaculty>(
        cells.map((c) => [c.programme_semester_subject_id, c]),
      );
      rows.forEach((r) => {
        const cell = bySubject.get(r.id);
        r.faculty = cell ? [cell] : [];
      });
    }

    return {
      rows,
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / opts.pageSize),
    };
  }

  async getOne(id: number): Promise<ProgrammeSemesterSubject> {
    const row = await this.entries
      .createQueryBuilder('pss')
      .leftJoinAndSelect('pss.programme_semester', 'programme_semester')
      .leftJoinAndSelect('pss.subject', 'subject')
      .leftJoinAndSelect('pss.options', 'options')
      .leftJoinAndSelect('options.subject', 'option_subject')
      .leftJoinAndSelect('options.faculty', 'option_faculty')
      .leftJoinAndSelect('option_faculty.employee', 'option_faculty_employee')
      .where('pss.id = :id', { id })
      .orderBy('options.id', 'ASC')
      .addOrderBy('option_faculty.id', 'ASC')
      .getOne();
    if (!row) throw new NotFoundException('Subject entry not found');
    return row;
  }

  async create(input: CreateInput): Promise<ProgrammeSemesterSubject> {
    const ps = await this.programmeSemesters.findOne({
      where: { id: input.programme_semester_id },
    });
    if (!ps) {
      throw new BadRequestException('Selected programme semester does not exist');
    }

    const isSlot = input.subject_id === undefined;

    // Real subject: must exist + belong to the batch's regulation, and not
    // already be configured for this semester.
    if (!isSlot) {
      const subject = await this.subjects.findOne({
        where: { id: input.subject_id! },
      });
      if (!subject) {
        throw new BadRequestException('Selected subject does not exist');
      }
      await this.assertSubjectMatchesBatchRegulation(
        ps.programme_id,
        ps.admission_year_id,
        subject.regulation_id,
      );
      await this.assertSubjectUniqueInProgrammeSemester(
        input.programme_semester_id,
        input.subject_id!,
      );
    } else {
      // Slot row: must specify which slot category it is and at least one
      // candidate subject. Validate the option pool up-front so a bad
      // subject id surfaces a 400 instead of an FK violation mid-transaction.
      if (input.slot_type === undefined) {
        throw new BadRequestException('slot_type is required for slot rows');
      }
      const optionIds = input.option_subject_ids ?? [];
      if (optionIds.length === 0) {
        throw new BadRequestException(
          'Pick at least one candidate subject for the slot',
        );
      }
      await this.validateOptionSubjects(
        optionIds,
        ps.programme_id,
        ps.admission_year_id,
      );
    }

    // Wrap entry insert + options insert in a transaction so a half-saved
    // elective slot can never exist. Re-reading must happen AFTER the
    // transaction commits — the outer repository uses a different
    // connection and can't see the in-flight writes otherwise.
    const savedId = await this.dataSource.transaction(async (tx) => {
      const entryRepo = tx.getRepository(ProgrammeSemesterSubject);
      const optionRepo = tx.getRepository(ProgrammeSemesterSubjectOption);

      const row = entryRepo.create({
        programme_semester_id: input.programme_semester_id,
        subject_id: input.subject_id ?? null,
        placeholder_name: input.placeholder_name ?? null,
        slot_type: isSlot ? input.slot_type! : null,
        credits: input.credits.toFixed(1),
        is_active: true,
      });
      const saved = await entryRepo.save(row);

      if (isSlot && input.option_subject_ids?.length) {
        const optionRows = input.option_subject_ids.map((sid) =>
          optionRepo.create({
            programme_semester_subject_id: saved.id,
            subject_id: sid,
          }),
        );
        await optionRepo.save(optionRows);
      }

      return saved.id;
    });

    return this.getOne(savedId);
  }

  async update(
    id: number,
    patch: UpdateInput,
  ): Promise<ProgrammeSemesterSubject> {
    const row = await this.entries.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Subject entry not found');

    // Snapshot what the row will look like after the patch is applied so we
    // can run the (subject xor placeholder) check before persisting.
    const nextSubjectId =
      patch.subject_id !== undefined ? patch.subject_id : row.subject_id;
    const nextPlaceholder =
      patch.placeholder_name !== undefined
        ? patch.placeholder_name
        : row.placeholder_name;
    const nextSlotType =
      patch.slot_type !== undefined ? patch.slot_type : row.slot_type;

    const hasSubject = nextSubjectId !== null && nextSubjectId !== undefined;
    const hasPlaceholder =
      nextPlaceholder !== null &&
      nextPlaceholder !== undefined &&
      nextPlaceholder !== '';
    if (hasSubject === hasPlaceholder) {
      throw new BadRequestException(
        'Provide exactly one of subject_id (real subject) or placeholder_name (slot)',
      );
    }

    // Real-subject rows must not carry an option pool or slot_type.
    if (hasSubject && patch.option_subject_ids && patch.option_subject_ids.length > 0) {
      throw new BadRequestException(
        'option_subject_ids is only valid for slot rows',
      );
    }
    if (hasSubject && nextSlotType !== null) {
      throw new BadRequestException(
        'slot_type is only valid for slot rows',
      );
    }
    if (!hasSubject && (nextSlotType === null || nextSlotType === undefined)) {
      throw new BadRequestException('slot_type is required for slot rows');
    }

    if (
      patch.subject_id !== undefined &&
      patch.subject_id !== null &&
      patch.subject_id !== row.subject_id
    ) {
      const subject = await this.subjects.findOne({
        where: { id: patch.subject_id },
      });
      if (!subject) {
        throw new BadRequestException('Selected subject does not exist');
      }
      const ps = await this.programmeSemesters.findOne({
        where: { id: row.programme_semester_id },
      });
      if (ps) {
        await this.assertSubjectMatchesBatchRegulation(
          ps.programme_id,
          ps.admission_year_id,
          subject.regulation_id,
        );
      }
      await this.assertSubjectUniqueInProgrammeSemester(
        row.programme_semester_id,
        patch.subject_id,
        id,
      );
    }

    // If the row is (becoming) an elective and the caller passed an option
    // pool, validate it up-front. If no option_subject_ids is provided in
    // the patch, leave existing options alone — pure metadata edits
    // (renaming the slot, changing credits) shouldn't disturb the pool.
    if (!hasSubject && patch.option_subject_ids !== undefined) {
      if (patch.option_subject_ids.length === 0) {
        throw new BadRequestException(
          'Pick at least one candidate subject for the slot',
        );
      }
      const ps = await this.programmeSemesters.findOne({
        where: { id: row.programme_semester_id },
      });
      if (ps) {
        await this.validateOptionSubjects(
          patch.option_subject_ids,
          ps.programme_id,
          ps.admission_year_id,
        );
      }
    }

    // If the row is becoming a real subject (was a slot before), drop any
    // existing options as part of the transition.
    const wasSlot = row.subject_id === null;
    const optionsBecomeStale = hasSubject && wasSlot;

    await this.dataSource.transaction(async (tx) => {
      const entryRepo = tx.getRepository(ProgrammeSemesterSubject);
      const optionRepo = tx.getRepository(ProgrammeSemesterSubjectOption);

      if (patch.subject_id !== undefined) row.subject_id = patch.subject_id;
      if (patch.placeholder_name !== undefined)
        row.placeholder_name = patch.placeholder_name;
      if (patch.slot_type !== undefined) row.slot_type = patch.slot_type;
      // Switching to a real subject implicitly clears slot_type even if the
      // patch didn't mention it, mirroring how options become stale.
      if (hasSubject) row.slot_type = null;
      if (patch.credits !== undefined) row.credits = patch.credits.toFixed(1);

      await entryRepo.save(row);

      if (optionsBecomeStale) {
        await optionRepo.delete({ programme_semester_subject_id: id });
      } else if (
        patch.option_subject_ids !== undefined &&
        !hasSubject /* slot */
      ) {
        // Replace semantics: wipe existing pool and re-insert. Simpler than
        // computing diffs and correctly handles re-ordering / dedupe.
        await optionRepo.delete({ programme_semester_subject_id: id });
        const optionRows = patch.option_subject_ids.map((sid) =>
          optionRepo.create({
            programme_semester_subject_id: id,
            subject_id: sid,
          }),
        );
        await optionRepo.save(optionRows);
      }
    });

    // Re-read AFTER commit so the outer repo can see the new state.
    return this.getOne(id);
  }

  async setActive(
    id: number,
    active: boolean,
  ): Promise<ProgrammeSemesterSubject> {
    const row = await this.entries.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Subject entry not found');
    if (row.is_active === active) return row;
    row.is_active = active;
    await this.entries.save(row);
    return this.getOne(id);
  }

  // Faculty configuration screen — load the (real subjects × attendance
  // groups) matrix for this batch in one shot. Slot rows are excluded: their
  // teacher is decided once a student picks a candidate, in the student-
  // allocation flow. The endpoint is also a sanity-check: callers must pass
  // a programme/admission-year pair that matches the semester they asked for.
  async getFacultyMatrix(opts: {
    programmeSemesterId: number;
    programmeId: number;
    admissionYearId: number;
  }): Promise<FacultyMatrixResult> {
    const ps = await this.programmeSemesters.findOne({
      where: { id: opts.programmeSemesterId },
    });
    if (!ps) throw new NotFoundException('Programme semester not found');
    if (
      ps.programme_id !== opts.programmeId ||
      ps.admission_year_id !== opts.admissionYearId
    ) {
      throw new BadRequestException(
        "This semester doesn't belong to the given programme/admission year batch.",
      );
    }

    const subjects = await this.entries
      .createQueryBuilder('pss')
      .leftJoinAndSelect('pss.subject', 'subject')
      .where('pss.programme_semester_id = :psid', {
        psid: opts.programmeSemesterId,
      })
      .andWhere('pss.subject_id IS NOT NULL')
      .orderBy('pss.is_active', 'DESC')
      .addOrderBy('pss.id', 'ASC')
      .getMany();

    const groups = await this.attendanceGroups
      .createQueryBuilder('g')
      .where('g.programme_id = :pid', { pid: opts.programmeId })
      .andWhere('g.admission_year_id = :ayid', { ayid: opts.admissionYearId })
      .orderBy('g.is_active', 'DESC')
      .addOrderBy('g.name', 'ASC')
      .getMany();

    const subjectIds = subjects.map((s) => s.id);
    const cellsRaw = subjectIds.length
      ? await this.groupFaculty
          .createQueryBuilder('cell')
          .leftJoinAndSelect('cell.employee', 'employee')
          .where('cell.programme_semester_subject_id IN (:...ids)', {
            ids: subjectIds,
          })
          .getMany()
      : [];
    const cells = cellsRaw.map((c) => ({
      id: c.id,
      programme_semester_subject_id: c.programme_semester_subject_id,
      attendance_group_id: c.attendance_group_id,
      employee_id: c.employee_id,
      employee: c.employee,
    }));

    return { subjects, groups, cells };
  }

  // Upsert one matrix cell. employee_id null clears the cell — the row is
  // deleted rather than kept around with a null teacher. Returns the fresh
  // matrix so the client can re-render without a separate refetch.
  async setGroupFaculty(input: {
    programmeSemesterSubjectId: number;
    attendanceGroupId: number;
    employeeId: number | null;
  }): Promise<FacultyMatrixResult> {
    const subject = await this.entries.findOne({
      where: { id: input.programmeSemesterSubjectId },
    });
    if (!subject) throw new NotFoundException('Subject entry not found');
    if (subject.subject_id === null) {
      throw new BadRequestException(
        "This is a slot row — its faculty are allocated in the student-allocation flow, not here.",
      );
    }

    const ps = await this.programmeSemesters.findOne({
      where: { id: subject.programme_semester_id },
    });
    if (!ps) {
      throw new NotFoundException('Programme semester not found for this subject');
    }

    const group = await this.attendanceGroups.findOne({
      where: { id: input.attendanceGroupId },
    });
    if (!group) throw new NotFoundException('Attendance group not found');
    if (
      group.programme_id !== ps.programme_id ||
      group.admission_year_id !== ps.admission_year_id
    ) {
      throw new BadRequestException(
        "This group doesn't belong to the subject's programme/admission year batch.",
      );
    }

    if (input.employeeId !== null) {
      await this.assertEmployeeAllocatable(input.employeeId);
    }

    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(ProgrammeSemesterSubjectGroupFaculty);
      await repo.delete({
        programme_semester_subject_id: input.programmeSemesterSubjectId,
        attendance_group_id: input.attendanceGroupId,
      });
      if (input.employeeId !== null) {
        await repo.save(
          repo.create({
            programme_semester_subject_id: input.programmeSemesterSubjectId,
            attendance_group_id: input.attendanceGroupId,
            employee_id: input.employeeId,
          }),
        );
      }
    });

    return this.getFacultyMatrix({
      programmeSemesterId: ps.id,
      programmeId: ps.programme_id,
      admissionYearId: ps.admission_year_id,
    });
  }

  // Replace the faculty roster for a single candidate subject of an
  // open-elective slot. Returns the parent subject entry so the caller gets
  // the whole refreshed graph (every candidate + its faculty). Will fold into
  // the student-allocation flow in a future change.
  async setOptionFaculty(
    optionId: number,
    employeeIds: number[],
  ): Promise<ProgrammeSemesterSubject> {
    const option = await this.options.findOne({ where: { id: optionId } });
    if (!option) {
      throw new NotFoundException('Elective candidate subject not found');
    }

    // Block emptying the faculty list when students are enrolled in this
    // candidate — a class can't run without a teacher, and downstream
    // timetable / attendance flows depend on at least one faculty being set.
    if (employeeIds.length === 0) {
      const enrolled = await this.optionStudents.count({
        where: { programme_semester_subject_option_id: optionId },
      });
      if (enrolled > 0) {
        throw new BadRequestException(
          `Can't remove all faculty — ${enrolled} student${enrolled === 1 ? ' is' : 's are'} enrolled in this candidate. Unenroll them first.`,
        );
      }
    }

    await this.assertEmployeesAllocatable(employeeIds);

    await this.dataSource.transaction(async (tx) => {
      const facultyRepo = tx.getRepository(ProgrammeSemesterSubjectOptionFaculty);
      await facultyRepo.delete({
        programme_semester_subject_option_id: optionId,
      });
      if (employeeIds.length > 0) {
        const rows = employeeIds.map((eid) =>
          facultyRepo.create({
            programme_semester_subject_option_id: optionId,
            employee_id: eid,
          }),
        );
        await facultyRepo.save(rows);
      }
    });

    return this.getOne(option.programme_semester_subject_id);
  }

  // Bulk variant of assertEmployeeAllocatable — used by the elective
  // candidate-faculty endpoint, which still takes a list.
  private async assertEmployeesAllocatable(
    employeeIds: number[],
  ): Promise<void> {
    if (employeeIds.length === 0) return;
    const found = await this.employees
      .createQueryBuilder('e')
      .where('e.id IN (:...ids)', { ids: employeeIds })
      .getMany();
    const byId = new Map(found.map((e) => [e.id, e]));
    const missing = employeeIds.filter((eid) => !byId.has(eid));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown faculty id(s): ${missing.join(', ')}`,
      );
    }
    const inactive = employeeIds
      .map((eid) => byId.get(eid)!)
      .filter((e) => !e.is_active);
    if (inactive.length > 0) {
      throw new BadRequestException(
        `Inactive faculty can't be allocated: ${inactive
          .map((e) => e.emp_code)
          .join(', ')}`,
      );
    }
  }

  // Validate one faculty up-front so a bad id surfaces a 400 instead of an FK
  // violation mid-transaction. Inactive employees can't be allocated.
  private async assertEmployeeAllocatable(employeeId: number): Promise<void> {
    const employee = await this.employees.findOne({
      where: { id: employeeId },
    });
    if (!employee) {
      throw new BadRequestException(`Unknown faculty id: ${employeeId}`);
    }
    if (!employee.is_active) {
      throw new BadRequestException(
        `Inactive faculty can't be allocated: ${employee.emp_code}`,
      );
    }
  }

  private async assertSubjectMatchesBatchRegulation(
    programmeId: number,
    admissionYearId: number,
    subjectRegulationId: number,
  ): Promise<void> {
    const link = await this.programmeAdmissionYears.findOne({
      where: {
        programme_id: programmeId,
        admission_year_id: admissionYearId,
      },
    });
    if (!link) {
      throw new BadRequestException(
        'This batch has no regulation assigned — assign one before adding subjects.',
      );
    }
    if (link.regulation_id !== subjectRegulationId) {
      throw new BadRequestException(
        "The selected subject doesn't belong to this batch's regulation.",
      );
    }
  }

  private async assertSubjectUniqueInProgrammeSemester(
    programmeSemesterId: number,
    subjectId: number,
    excludeId?: number,
  ): Promise<void> {
    const qb = this.entries
      .createQueryBuilder('pss')
      .where('pss.programme_semester_id = :psid', { psid: programmeSemesterId })
      .andWhere('pss.subject_id = :sid', { sid: subjectId });
    if (excludeId !== undefined) qb.andWhere('pss.id != :id', { id: excludeId });
    if (await qb.getOne()) {
      throw new ConflictException(
        'This subject is already configured for the semester.',
      );
    }
  }

  // Bulk-validate every candidate subject id in an elective's pool: each
  // must exist and belong to the batch's regulation. Dedupe is enforced by
  // the DTO already.
  private async validateOptionSubjects(
    subjectIds: number[],
    programmeId: number,
    admissionYearId: number,
  ): Promise<void> {
    const found = await this.subjects
      .createQueryBuilder('s')
      .where('s.id IN (:...ids)', { ids: subjectIds })
      .getMany();
    const byId = new Map(found.map((s) => [s.id, s]));
    const missing = subjectIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown candidate subject id(s): ${missing.join(', ')}`,
      );
    }

    const link = await this.programmeAdmissionYears.findOne({
      where: { programme_id: programmeId, admission_year_id: admissionYearId },
    });
    if (!link) {
      throw new BadRequestException(
        'This batch has no regulation assigned — assign one before adding subjects.',
      );
    }
    const offenders = subjectIds.filter(
      (id) => byId.get(id)!.regulation_id !== link.regulation_id,
    );
    if (offenders.length > 0) {
      throw new BadRequestException(
        "One or more candidate subjects don't belong to this batch's regulation.",
      );
    }
  }
}
