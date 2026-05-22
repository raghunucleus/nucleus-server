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
import { ProgrammeSemesterSubject } from './programme-semester-subject.entity';

// One row per (configured subject entry, faculty) pair. A subject can be
// taught by several faculty, so multiple rows share a
// programme_semester_subject_id; the unique constraint only stops the same
// faculty being linked to the same entry twice.
@Entity({ name: 'programme_semester_subject_faculty' })
@Unique('UQ_pss_faculty_entry_employee', [
  'programme_semester_subject_id',
  'employee_id',
])
@Index('IDX_pss_faculty_entry_id', ['programme_semester_subject_id'])
@Index('IDX_pss_faculty_employee_id', ['employee_id'])
export class ProgrammeSemesterSubjectFaculty {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_semester_subject_id: number;

  @ManyToOne(() => ProgrammeSemesterSubject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programme_semester_subject_id' })
  programme_semester_subject: ProgrammeSemesterSubject;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @CreateDateColumn()
  created_at: Date;
}
