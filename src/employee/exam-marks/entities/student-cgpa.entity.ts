import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ProgrammeAdmissionYear } from '../../../admin/entities/programme-admission-year.entity';
import { Student } from '../../../admin/entities/student.entity';

/**
 * Cached CGPA and per-student aggregates, computed once at upload time from the
 * `is_best` attempts (CGPA = Σ Cᵢ·Gᵢ / Σ Cᵢ over every best attempt across all
 * semesters, computed from subjects directly to avoid compounding rounding).
 * One row per student; overwritten with the batch on every upload. A student
 * belongs to exactly one batch, so `student_id` is unique.
 */
@Entity({ name: 'student_cgpa' })
@Unique('UQ_student_cgpa_student_id', ['student_id'])
@Index('IDX_student_cgpa_programme_admission_year_id', [
  'programme_admission_year_id',
])
export class StudentCgpa {
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

  // credit_points / total_credits, rounded to 2 dp.
  @Column({ type: 'numeric', precision: 5, scale: 2 })
  cgpa: string;

  // Σ Cᵢ across all semesters (the CGPA denominator).
  @Column({ type: 'numeric', precision: 7, scale: 1 })
  total_credits: string;

  // Σ (Cᵢ · Gᵢ) across all semesters (the CGPA numerator).
  @Column({ type: 'numeric', precision: 9, scale: 1 })
  credit_points: string;

  @Column({ type: 'int' })
  semesters_count: number;

  @Column({ type: 'int' })
  subjects_count: number;

  @Column({ type: 'int' })
  passed_count: number;

  @Column({ type: 'int' })
  backlog_count: number;

  @CreateDateColumn()
  computed_at: Date;
}
