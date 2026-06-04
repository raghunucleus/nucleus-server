import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';
import { StudentCgpa } from '../../employee/exam-marks/entities/student-cgpa.entity';
import { StudentExamResult } from '../../employee/exam-marks/entities/student-exam-result.entity';
import { StudentSemesterGpa } from '../../employee/exam-marks/entities/student-semester-gpa.entity';
import {
  groupSubjectsBySemester,
  type ResultSubject as StudentResultSubject,
} from '../../employee/exam-marks/exam-results-grouping';

export type { StudentResultSubject };

export interface StudentResultSemester {
  semester: number;
  sgpa: number;
  total_credits: number;
  subjects_count: number;
  passed_count: number;
  backlog_count: number;
  passed: boolean;
  subjects: StudentResultSubject[];
}

export interface StudentExamResultsView {
  has_results: boolean;
  context: { programme: string; admission_year: string };
  cgpa: number;
  total_credits: number;
  semesters_count: number;
  subjects_count: number;
  passed_count: number;
  backlog_count: number;
  semesters: StudentResultSemester[];
}

/**
 * Read-only view of the signed-in student's own exam results, assembled from
 * the cached aggregate tables. Every query is keyed on the `studentId` taken
 * from the JWT by the controller — never a client-supplied id. Only the
 * best/current attempt per subject is exposed (no failed-attempt history).
 */
@Injectable()
export class StudentExamResultsService {
  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @InjectRepository(StudentCgpa)
    private readonly cgpas: Repository<StudentCgpa>,
    @InjectRepository(StudentSemesterGpa)
    private readonly semesterGpas: Repository<StudentSemesterGpa>,
    @InjectRepository(StudentExamResult)
    private readonly examResults: Repository<StudentExamResult>,
  ) {}

  async myResults(studentId: number): Promise<StudentExamResultsView> {
    // programme + admission_year are eager relations on Student.
    const student = await this.students.findOne({ where: { id: studentId } });
    const context = {
      programme: student?.programme?.name ?? '',
      admission_year: student?.admission_year?.display_year ?? '',
    };

    const cgpa = await this.cgpas.findOne({ where: { student_id: studentId } });
    if (!cgpa) {
      return {
        has_results: false,
        context,
        cgpa: 0,
        total_credits: 0,
        semesters_count: 0,
        subjects_count: 0,
        passed_count: 0,
        backlog_count: 0,
        semesters: [],
      };
    }

    const semesterRows = await this.semesterGpas.find({
      where: { student_id: studentId },
      order: { semester: 'ASC' },
    });

    // All sittings (not just the best) so the screen can expand a subject's
    // attempt history. Ordered so grouping yields subjects A→Z and attempts
    // oldest→newest. SGPA/counts still come from the cached best-attempt rows.
    const subjectRows = await this.examResults.find({
      where: { student_id: studentId },
      order: { semester: 'ASC', subject_code: 'ASC', exam_date: 'ASC' },
    });

    const subjectsBySemester = groupSubjectsBySemester(subjectRows);

    return {
      has_results: true,
      context,
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
}
