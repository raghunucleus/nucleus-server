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
 * Cached SGPA and every per-semester aggregate, computed once at upload time
 * from the `is_best` attempts so result reads are pure SELECTs with no
 * arithmetic. `credit_points` (Σ Cᵢ·Gᵢ) and `total_credits` (Σ Cᵢ) are stored
 * so CGPA is derived by summing these across semesters — never recomputed from
 * subject rows. Overwritten with the batch on every upload.
 */
@Entity({ name: 'student_semester_gpa' })
@Unique('UQ_student_semester_gpa_student_id_semester', [
  'student_id',
  'semester',
])
@Index('IDX_student_semester_gpa_programme_admission_year_id', [
  'programme_admission_year_id',
])
export class StudentSemesterGpa {
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

  @Column({ type: 'smallint' })
  semester: number;

  // credit_points / total_credits, rounded to 2 dp (0 when no earned credits).
  @Column({ type: 'numeric', precision: 5, scale: 2 })
  sgpa: string;

  // Σ Cᵢ over the semester's best attempts (the SGPA denominator).
  @Column({ type: 'numeric', precision: 6, scale: 1 })
  total_credits: string;

  // Σ (Cᵢ · Gᵢ) over the semester's best attempts (the SGPA numerator).
  @Column({ type: 'numeric', precision: 8, scale: 1 })
  credit_points: string;

  @Column({ type: 'int' })
  subjects_count: number;

  @Column({ type: 'int' })
  passed_count: number;

  @Column({ type: 'int' })
  backlog_count: number;

  @CreateDateColumn()
  computed_at: Date;
}
