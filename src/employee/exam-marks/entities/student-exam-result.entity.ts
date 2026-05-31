import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProgrammeAdmissionYear } from '../../../admin/entities/programme-admission-year.entity';
import { Student } from '../../../admin/entities/student.entity';

/**
 * One uploaded grade-sheet row — a single (student × semester × subject ×
 * sitting). The full attempt history is kept so "all attempts" stays viewable;
 * the attempt used for SGPA/CGPA is flagged with `is_best`. All rows for a
 * (programme × admission-year) batch are deleted and re-inserted on every
 * upload, so the table mirrors exactly the latest sheet for that batch.
 */
@Entity({ name: 'student_exam_results' })
@Index('IDX_student_exam_results_programme_admission_year_id', [
  'programme_admission_year_id',
])
@Index('IDX_student_exam_results_student_id_semester', [
  'student_id',
  'semester',
])
@Index('IDX_student_exam_results_student_subject', [
  'student_id',
  'semester',
  'subject_code',
])
export class StudentExamResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_admission_year_id: number;

  @ManyToOne(() => ProgrammeAdmissionYear, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programme_admission_year_id' })
  programme_admission_year: ProgrammeAdmissionYear;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // 1–8, derived from the column-A examination label.
  @Column({ type: 'smallint' })
  semester: number;

  // 'regular' | 'supply' — enforced by parseExamination at upload time. With
  // `semester` this reconstructs the column-A label, so the raw text is not
  // stored (e.g. semester 5 + supply → "III YEAR I SEMESTER Supply").
  @Column({ type: 'varchar', length: 16 })
  exam_type: string;

  @Column({ type: 'date' })
  exam_date: string;

  @Column({ type: 'varchar', length: 32 })
  subject_code: string;

  @Column({ type: 'varchar', length: 128 })
  subject_name: string;

  // Credits *earned* for this sitting — 0 for F/P, the subject's credit otherwise.
  @Column({ type: 'numeric', precision: 5, scale: 1 })
  credits: string;

  @Column({ type: 'varchar', length: 2 })
  grade: string;

  @Column({ type: 'numeric', precision: 4, scale: 1 })
  grade_points: string;

  // True for the attempt used in SGPA/CGPA — highest grade_points per
  // (student, semester, subject_code), tie-broken by latest exam_date.
  @Column({ type: 'boolean', default: false })
  is_best: boolean;

  @CreateDateColumn()
  created_at: Date;
}
