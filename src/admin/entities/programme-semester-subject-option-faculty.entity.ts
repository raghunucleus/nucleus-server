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
import { Employee } from './employee.entity';
import { ProgrammeSemesterSubjectOption } from './programme-semester-subject-option.entity';

// One row per (elective candidate subject, faculty) pair. An open-elective
// slot's candidate subjects are taught independently, so faculty are
// allocated per candidate subject — not to the slot as a whole. A candidate
// may be taught by several faculty; the unique constraint only stops the same
// faculty being linked to the same candidate twice.
//
// TODO: this table will eventually move into the student-allocation flow —
// students pick (candidate, teacher) in one step, so pre-allocating teachers
// to candidates here becomes redundant. Until that redesign lands, the
// slot-enrollments validator still requires these rows.
@Entity({ name: 'programme_semester_subject_option_faculty' })
@Unique('UQ_pss_opt_faculty_option_employee', [
  'programme_semester_subject_option_id',
  'employee_id',
])
@Index('IDX_pss_opt_faculty_option_id', ['programme_semester_subject_option_id'])
@Index('IDX_pss_opt_faculty_employee_id', ['employee_id'])
export class ProgrammeSemesterSubjectOptionFaculty {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_semester_subject_option_id: number;

  @ManyToOne(() => ProgrammeSemesterSubjectOption, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programme_semester_subject_option_id' })
  programme_semester_subject_option: ProgrammeSemesterSubjectOption;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @CreateDateColumn()
  created_at: Date;
}
