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
import { Student } from './student.entity';

// One row per (slot candidate, enrolled student). A student picking
// "Python Programming" inside "Open Elective 1" produces one row here.
//
// `programme_semester_subject_id` is denormalised from the parent option so
// the DB can enforce "one candidate per student per slot" via a UNIQUE
// constraint on (slot id, student id). The service layer keeps the two
// columns in sync on insert.
@Entity({ name: 'programme_semester_subject_option_students' })
@Unique('UQ_pss_opt_students_option_student', [
  'programme_semester_subject_option_id',
  'student_id',
])
@Unique('UQ_pss_opt_students_slot_student', [
  'programme_semester_subject_id',
  'student_id',
])
@Index('IDX_pss_opt_students_option_id', [
  'programme_semester_subject_option_id',
])
@Index('IDX_pss_opt_students_slot_id', ['programme_semester_subject_id'])
@Index('IDX_pss_opt_students_student_id', ['student_id'])
@Index('IDX_pss_opt_students_employee_id', ['employee_id'])
export class ProgrammeSemesterSubjectOptionStudent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_semester_subject_option_id: number;

  @ManyToOne(() => ProgrammeSemesterSubjectOption, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programme_semester_subject_option_id' })
  programme_semester_subject_option: ProgrammeSemesterSubjectOption;

  // Denormalised parent slot id. Kept in sync with the parent option's slot
  // by the service; lets the UNIQUE (slot_id, student_id) constraint do the
  // "one candidate per slot per student" check.
  @Column({ type: 'int' })
  programme_semester_subject_id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // The faculty (employee) teaching this student for the chosen candidate.
  // Must be one of the option's allocated faculty — enforced in service.
  // Drives the student's timetable and attendance pipeline for this slot.
  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @CreateDateColumn()
  created_at: Date;
}
