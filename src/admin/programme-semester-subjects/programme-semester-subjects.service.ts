import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { ProgrammeSemesterSubjectsSortField } from '../dto/list-programme-semester-subjects.dto';
import { Employee } from '../entities/employee.entity';
import { ProgrammeAdmissionYear } from '../entities/programme-admission-year.entity';
import { ProgrammeSemester } from '../entities/programme-semester.entity';
import { ProgrammeSemesterSubject } from '../entities/programme-semester-subject.entity';
import { ProgrammeSemesterSubjectFaculty } from '../entities/programme-semester-subject-faculty.entity';
import { ProgrammeSemesterSubjectOption } from '../entities/programme-semester-subject-option.entity';
import { ProgrammeSemesterSubjectOptionFaculty } from '../entities/programme-semester-subject-option-faculty.entity';
import { Subject } from '../entities/subject.entity';

export interface ListProgrammeSemesterSubjectsResult {
  rows: ProgrammeSemesterSubject[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
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
  option_subject_ids?: number[];
  credits: number;
}

interface UpdateInput {
  subject_id?: number | null;
  placeholder_name?: string | null;
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
  }): Promise<ListProgrammeSemesterSubjectsResult> {
    const qb = this.entries
      .createQueryBuilder('pss')
      .leftJoinAndSelect('pss.programme_semester', 'programme_semester')
      .leftJoinAndSelect('pss.subject', 'subject')
      .leftJoinAndSelect('pss.options', 'options')
      .leftJoinAndSelect('options.subject', 'option_subject')
      .leftJoinAndSelect('options.faculty', 'option_faculty')
      .leftJoinAndSelect('option_faculty.employee', 'option_faculty_employee')
      .leftJoinAndSelect('pss.faculty', 'faculty')
      .leftJoinAndSelect('faculty.employee', 'faculty_employee');

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
      .addOrderBy('faculty.id', 'ASC')
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

  async getOne(id: number): Promise<ProgrammeSemesterSubject> {
    const row = await this.entries
      .createQueryBuilder('pss')
      .leftJoinAndSelect('pss.programme_semester', 'programme_semester')
      .leftJoinAndSelect('pss.subject', 'subject')
      .leftJoinAndSelect('pss.options', 'options')
      .leftJoinAndSelect('options.subject', 'option_subject')
      .leftJoinAndSelect('options.faculty', 'option_faculty')
      .leftJoinAndSelect('option_faculty.employee', 'option_faculty_employee')
      .leftJoinAndSelect('pss.faculty', 'faculty')
      .leftJoinAndSelect('faculty.employee', 'faculty_employee')
      .where('pss.id = :id', { id })
      .orderBy('options.id', 'ASC')
      .addOrderBy('option_faculty.id', 'ASC')
      .addOrderBy('faculty.id', 'ASC')
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

    const isElective = input.subject_id === undefined;

    // Real subject: must exist + belong to the batch's regulation, and not
    // already be configured for this semester.
    if (!isElective) {
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
      // Elective: validate the option pool up-front so a bad subject id
      // surfaces a 400 instead of an FK violation mid-transaction.
      const optionIds = input.option_subject_ids ?? [];
      if (optionIds.length === 0) {
        throw new BadRequestException(
          'Pick at least one candidate subject for the elective slot',
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
        credits: input.credits.toFixed(1),
        is_active: true,
      });
      const saved = await entryRepo.save(row);

      if (isElective && input.option_subject_ids?.length) {
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

    const hasSubject = nextSubjectId !== null && nextSubjectId !== undefined;
    const hasPlaceholder =
      nextPlaceholder !== null &&
      nextPlaceholder !== undefined &&
      nextPlaceholder !== '';
    if (hasSubject === hasPlaceholder) {
      throw new BadRequestException(
        'Provide exactly one of subject_id (real subject) or placeholder_name (elective slot)',
      );
    }

    // Real-subject rows must not carry an option pool.
    if (hasSubject && patch.option_subject_ids && patch.option_subject_ids.length > 0) {
      throw new BadRequestException(
        'option_subject_ids is only valid for open-elective slots',
      );
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
          'Pick at least one candidate subject for the elective slot',
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

    // If the row is becoming a real subject (was elective before), drop any
    // existing options as part of the transition.
    const wasElective = row.subject_id === null;
    const optionsBecomeStale = hasSubject && wasElective;

    await this.dataSource.transaction(async (tx) => {
      const entryRepo = tx.getRepository(ProgrammeSemesterSubject);
      const optionRepo = tx.getRepository(ProgrammeSemesterSubjectOption);

      if (patch.subject_id !== undefined) row.subject_id = patch.subject_id;
      if (patch.placeholder_name !== undefined)
        row.placeholder_name = patch.placeholder_name;
      if (patch.credits !== undefined) row.credits = patch.credits.toFixed(1);

      await entryRepo.save(row);

      if (optionsBecomeStale) {
        await optionRepo.delete({ programme_semester_subject_id: id });
      } else if (
        patch.option_subject_ids !== undefined &&
        !hasSubject /* elective */
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

  // Replace the faculty roster for a REAL subject entry. The provided list
  // becomes the complete set — an empty list clears it. Open-elective slots
  // are rejected: their faculty are allocated per candidate subject via
  // setOptionFaculty.
  async setFaculty(
    id: number,
    employeeIds: number[],
  ): Promise<ProgrammeSemesterSubject> {
    const row = await this.entries.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Subject entry not found');
    if (row.subject_id === null) {
      throw new BadRequestException(
        'This is an open-elective slot — allocate faculty to its candidate subjects instead.',
      );
    }

    await this.assertEmployeesAllocatable(employeeIds);

    // Replace semantics: wipe the existing roster and re-insert. Mirrors how
    // the elective option pool is kept in sync with the form's snapshot.
    await this.dataSource.transaction(async (tx) => {
      const facultyRepo = tx.getRepository(ProgrammeSemesterSubjectFaculty);
      await facultyRepo.delete({ programme_semester_subject_id: id });
      if (employeeIds.length > 0) {
        const rows = employeeIds.map((eid) =>
          facultyRepo.create({
            programme_semester_subject_id: id,
            employee_id: eid,
          }),
        );
        await facultyRepo.save(rows);
      }
    });

    return this.getOne(id);
  }

  // Replace the faculty roster for a single candidate subject of an
  // open-elective slot. Returns the parent subject entry so the caller gets
  // the whole refreshed graph (every candidate + its faculty).
  async setOptionFaculty(
    optionId: number,
    employeeIds: number[],
  ): Promise<ProgrammeSemesterSubject> {
    const option = await this.options.findOne({ where: { id: optionId } });
    if (!option) {
      throw new NotFoundException('Elective candidate subject not found');
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

  // Validate a faculty roster up-front so a bad id surfaces a 400 instead of
  // an FK violation mid-transaction. Inactive employees can't be allocated.
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
