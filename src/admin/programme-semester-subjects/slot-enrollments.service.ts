import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProgrammeSemester } from '../entities/programme-semester.entity';
import { ProgrammeSemesterSubject } from '../entities/programme-semester-subject.entity';
import { ProgrammeSemesterSubjectOption } from '../entities/programme-semester-subject-option.entity';
import { ProgrammeSemesterSubjectOptionStudent } from '../entities/programme-semester-subject-option-student.entity';
import { Student } from '../entities/student.entity';

export interface SlotEnrollmentBulkRow {
  student_id: string;
  // Both must be set together, or both null (clear). Enforced by the DTO.
  option_subject_code: string | null;
  faculty_emp_code: string | null;
}

export interface SlotEnrollmentRowError {
  rowIndex: number;
  field: 'student_id' | 'option_subject_code' | 'faculty_emp_code';
  message: string;
}

export interface SlotEnrollmentBulkError {
  rowErrors: SlotEnrollmentRowError[];
}

export interface SlotEnrollmentFacultyView {
  employee_id: number;
  emp_code: string;
  emp_display_name: string;
}

export interface SlotEnrollmentOptionView {
  option_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  faculty: SlotEnrollmentFacultyView[];
  student_count: number;
}

export interface SlotEnrollmentStudentView {
  student_id: number;
  student_code: string;
  display_name: string;
  // The student's current pick — both null if they haven't picked yet.
  option_id: number | null;
  employee_id: number | null;
}

export interface SlotEnrollmentView {
  slot_id: number;
  slot_name: string;
  slot_type: string | null;
  programme_id: number;
  admission_year_id: number;
  options: SlotEnrollmentOptionView[];
  students: SlotEnrollmentStudentView[];
}

@Injectable()
export class SlotEnrollmentsService {
  constructor(
    @InjectRepository(ProgrammeSemesterSubject)
    private readonly slots: Repository<ProgrammeSemesterSubject>,
    @InjectRepository(ProgrammeSemesterSubjectOption)
    private readonly options: Repository<ProgrammeSemesterSubjectOption>,
    @InjectRepository(ProgrammeSemesterSubjectOptionStudent)
    private readonly enrollments: Repository<ProgrammeSemesterSubjectOptionStudent>,
    @InjectRepository(ProgrammeSemester)
    private readonly programmeSemesters: Repository<ProgrammeSemester>,
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    private readonly dataSource: DataSource,
  ) {}

  // Pulls everything the enrollment matrix UI needs in one shot: the slot
  // metadata, its candidates (each with the full faculty roster + per-option
  // student count), the slot's batch student roster, and each student's
  // current (candidate, faculty) pick.
  async getView(slotId: number): Promise<SlotEnrollmentView> {
    const slot = await this.slots.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.subject_id !== null) {
      throw new BadRequestException(
        'This row is a real subject, not a slot — enrollments only apply to slots.',
      );
    }

    const ps = await this.programmeSemesters.findOne({
      where: { id: slot.programme_semester_id },
    });
    if (!ps) {
      throw new NotFoundException('Parent programme-semester not found');
    }

    const options = await this.options
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.subject', 'subject')
      .leftJoinAndSelect('o.faculty', 'faculty')
      .leftJoinAndSelect('faculty.employee', 'faculty_employee')
      .where('o.programme_semester_subject_id = :slotId', { slotId })
      .orderBy('o.id', 'ASC')
      .addOrderBy('faculty.id', 'ASC')
      .getMany();

    // Per-option student counts.
    const optionIds = options.map((o) => o.id);
    const countRows: { option_id: string; count: string }[] =
      optionIds.length === 0
        ? []
        : await this.enrollments
            .createQueryBuilder('e')
            .select('e.programme_semester_subject_option_id', 'option_id')
            .addSelect('COUNT(*)', 'count')
            .where('e.programme_semester_subject_option_id IN (:...ids)', {
              ids: optionIds,
            })
            .groupBy('e.programme_semester_subject_option_id')
            .getRawMany();
    const studentCountByOption = new Map<number, number>();
    for (const r of countRows) {
      studentCountByOption.set(Number(r.option_id), Number(r.count));
    }

    const optionViews: SlotEnrollmentOptionView[] = options.map((o) => ({
      option_id: o.id,
      subject_id: o.subject_id,
      subject_code: o.subject?.code ?? '',
      subject_name: o.subject?.name ?? '',
      faculty: (o.faculty ?? []).map((f) => ({
        employee_id: f.employee_id,
        emp_code: f.employee?.emp_code ?? '',
        emp_display_name: f.employee?.emp_display_name ?? '',
      })),
      student_count: studentCountByOption.get(o.id) ?? 0,
    }));

    // Roster = active students in the same (programme, admission year) as
    // the slot. Deactivated students are excluded — they can't enroll.
    const roster = await this.students
      .createQueryBuilder('s')
      .where('s.programme_id = :pid', { pid: ps.programme_id })
      .andWhere('s.admission_year_id = :ayid', { ayid: ps.admission_year_id })
      .andWhere('s.is_active = TRUE')
      .orderBy('s.student_id', 'ASC')
      .getMany();

    // Current assignments for this slot (both option and faculty).
    const assignments = await this.enrollments
      .createQueryBuilder('e')
      .where('e.programme_semester_subject_id = :slotId', { slotId })
      .getMany();
    const pickByStudent = new Map<
      number,
      { option_id: number; employee_id: number }
    >();
    for (const a of assignments) {
      pickByStudent.set(a.student_id, {
        option_id: a.programme_semester_subject_option_id,
        employee_id: a.employee_id,
      });
    }

    const studentViews: SlotEnrollmentStudentView[] = roster.map((s) => {
      const pick = pickByStudent.get(s.id);
      return {
        student_id: s.id,
        student_code: s.student_id,
        display_name: s.display_name,
        option_id: pick?.option_id ?? null,
        employee_id: pick?.employee_id ?? null,
      };
    });

    return {
      slot_id: slot.id,
      slot_name: slot.placeholder_name ?? '',
      slot_type: slot.slot_type,
      programme_id: ps.programme_id,
      admission_year_id: ps.admission_year_id,
      options: optionViews,
      students: studentViews,
    };
  }

  // Bulk REPLACE: each row's student gets their existing slot assignment
  // dropped, then a new (candidate, faculty) pair is recorded — or both are
  // cleared. Students NOT listed in `rows` are untouched. Validated
  // atomically; commit-all-or-nothing.
  async bulkSetForSlot(
    slotId: number,
    rows: SlotEnrollmentBulkRow[],
  ): Promise<{ applied: number; cleared: number }> {
    const slot = await this.slots.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Slot not found');
    if (slot.subject_id !== null) {
      throw new BadRequestException(
        'This row is a real subject, not a slot — enrollments only apply to slots.',
      );
    }

    const ps = await this.programmeSemesters.findOne({
      where: { id: slot.programme_semester_id },
    });
    if (!ps) {
      throw new NotFoundException('Parent programme-semester not found');
    }

    const options = await this.options
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.subject', 'subject')
      .leftJoinAndSelect('o.faculty', 'faculty')
      .leftJoinAndSelect('faculty.employee', 'faculty_employee')
      .where('o.programme_semester_subject_id = :slotId', { slotId })
      .getMany();
    const optionsByCode = new Map<string, ProgrammeSemesterSubjectOption>();
    for (const o of options) {
      if (o.subject?.code) optionsByCode.set(o.subject.code.toUpperCase(), o);
    }

    const studentCodes = Array.from(
      new Set(rows.map((r) => r.student_id.toUpperCase())),
    );
    const studentsFound = await this.students
      .createQueryBuilder('s')
      .where('s.student_id IN (:...codes)', { codes: studentCodes })
      .getMany();
    const studentByCode = new Map<string, Student>();
    for (const s of studentsFound) {
      studentByCode.set(s.student_id.toUpperCase(), s);
    }

    const rowErrors: SlotEnrollmentRowError[] = [];
    const seenStudents = new Set<string>();
    // Track which option each row resolves to so the commit phase can build
    // inserts without re-doing the lookup. Aligned 1:1 with `rows`.
    const resolved: Array<{
      student: Student | null;
      option: ProgrammeSemesterSubjectOption | null;
      employee_id: number | null;
    }> = rows.map(() => ({ student: null, option: null, employee_id: null }));

    rows.forEach((row, i) => {
      const sc = row.student_id.toUpperCase();
      if (seenStudents.has(sc)) {
        rowErrors.push({
          rowIndex: i,
          field: 'student_id',
          message: `Duplicate student_id "${row.student_id}" in this upload`,
        });
      }
      seenStudents.add(sc);

      const student = studentByCode.get(sc);
      if (!student) {
        rowErrors.push({
          rowIndex: i,
          field: 'student_id',
          message: `No active student with student_id "${row.student_id}"`,
        });
        return;
      }
      if (!student.is_active) {
        rowErrors.push({
          rowIndex: i,
          field: 'student_id',
          message: `Student "${row.student_id}" is deactivated`,
        });
        return;
      }
      if (
        student.programme_id !== ps.programme_id ||
        student.admission_year_id !== ps.admission_year_id
      ) {
        rowErrors.push({
          rowIndex: i,
          field: 'student_id',
          message: `Student "${row.student_id}" isn't in this slot's batch`,
        });
        return;
      }
      resolved[i].student = student;

      // Clear-row case: both null. Already validated by DTO that they
      // agree (both set or both null), so we just need to know which it is.
      if (row.option_subject_code === null) return;

      const opt = optionsByCode.get(row.option_subject_code.toUpperCase());
      if (!opt) {
        rowErrors.push({
          rowIndex: i,
          field: 'option_subject_code',
          message: `"${row.option_subject_code}" isn't a candidate of this slot`,
        });
        return;
      }
      if ((opt.faculty?.length ?? 0) === 0) {
        rowErrors.push({
          rowIndex: i,
          field: 'option_subject_code',
          message: `"${row.option_subject_code}" has no faculty allocated — allocate at least one before enrolling students`,
        });
        return;
      }
      resolved[i].option = opt;

      // Faculty must be one of the candidate's allocated faculty. We match
      // on emp_code (user-facing identifier) and resolve to employee_id.
      const facultyCode = (row.faculty_emp_code ?? '').toUpperCase();
      const facultyRow = (opt.faculty ?? []).find(
        (f) => (f.employee?.emp_code ?? '').toUpperCase() === facultyCode,
      );
      if (!facultyRow) {
        rowErrors.push({
          rowIndex: i,
          field: 'faculty_emp_code',
          message: `"${row.faculty_emp_code}" isn't allocated as faculty for "${row.option_subject_code}"`,
        });
        return;
      }
      resolved[i].employee_id = facultyRow.employee_id;
    });

    if (rowErrors.length > 0) {
      throw new BadRequestException({
        message: 'Bulk enrollment validation failed',
        rowErrors,
      } satisfies SlotEnrollmentBulkError & { message: string });
    }

    let applied = 0;
    let cleared = 0;
    await this.dataSource.transaction(async (tx) => {
      const repo = tx.getRepository(ProgrammeSemesterSubjectOptionStudent);

      const studentIdsAffected = resolved
        .filter((r) => r.student !== null)
        .map((r) => r.student!.id);

      if (studentIdsAffected.length > 0) {
        await repo
          .createQueryBuilder()
          .delete()
          .where('programme_semester_subject_id = :slotId', { slotId })
          .andWhere('student_id IN (:...sids)', { sids: studentIdsAffected })
          .execute();
      }

      const inserts: ProgrammeSemesterSubjectOptionStudent[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const r = resolved[i];
        if (!r.student) continue;
        if (r.option === null) {
          cleared += 1;
          continue;
        }
        inserts.push(
          repo.create({
            programme_semester_subject_option_id: r.option.id,
            programme_semester_subject_id: slotId,
            student_id: r.student.id,
            employee_id: r.employee_id!,
          }),
        );
        applied += 1;
      }
      if (inserts.length > 0) {
        await repo.save(inserts);
      }
    });

    return { applied, cleared };
  }

  async countStudentsInOption(optionId: number): Promise<number> {
    return this.enrollments.count({
      where: { programme_semester_subject_option_id: optionId },
    });
  }

  async hasEnrolledStudents(optionId: number): Promise<boolean> {
    const c = await this.countStudentsInOption(optionId);
    return c > 0;
  }
}
