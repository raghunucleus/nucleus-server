import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Transient staging for one chunked upload session. The client streams parsed
 * rows here in chunks; each row is validated + parsed on arrival (resolved
 * `student_id`/`semester`, or `error_*` when invalid). On commit the session's
 * rows are aggregated into the real result tables in one atomic transaction and
 * then deleted. No FK to students — `student_id` is nullable so an unmatched
 * HT No can still be staged and reported as an error.
 */
@Entity({ name: 'student_exam_result_staging' })
@Index('IDX_student_exam_result_staging_session', ['upload_session'])
@Index('IDX_student_exam_result_staging_session_subject', [
  'upload_session',
  'student_id',
  'semester',
  'subject_code',
])
@Index('IDX_student_exam_result_staging_pay', ['programme_admission_year_id'])
@Index('IDX_student_exam_result_staging_employee', ['employee_id'])
export class StudentExamResultStaging {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  upload_session: string;

  @Column({ type: 'int' })
  employee_id: number;

  @Column({ type: 'int' })
  programme_admission_year_id: number;

  // 0-based index into the client's submitted rows array (for error mapping).
  @Column({ type: 'int' })
  row_index: number;

  @Column({ type: 'varchar', length: 64 })
  examination: string;

  @Column({ type: 'date', nullable: true })
  exam_date: string | null;

  @Column({ type: 'varchar', length: 32 })
  roll_number: string;

  @Column({ type: 'varchar', length: 32 })
  subject_code: string;

  @Column({ type: 'varchar', length: 128 })
  subject_name: string;

  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true })
  credits: string | null;

  @Column({ type: 'varchar', length: 8 })
  grade: string;

  @Column({ type: 'numeric', precision: 4, scale: 1, nullable: true })
  grade_points: string | null;

  @Column({ type: 'smallint', nullable: true })
  semester: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  exam_type: string | null;

  @Column({ type: 'int', nullable: true })
  student_id: number | null;

  // Set when the row failed validation; cleared (null) when valid.
  @Column({ type: 'varchar', length: 32, nullable: true })
  error_column: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  error_reason: string | null;

  @CreateDateColumn()
  created_at: Date;
}
