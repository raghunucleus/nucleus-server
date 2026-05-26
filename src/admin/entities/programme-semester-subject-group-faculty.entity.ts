import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AttendanceGroup } from './attendance-group.entity';
import { Employee } from './employee.entity';
import { ProgrammeSemesterSubject } from './programme-semester-subject.entity';

// One row per (subject entry, attendance group) cell — a single teacher per
// group per subject. A subject offered to N groups has up to N rows, each
// pointing at one teacher; the same teacher may appear across multiple cells.
//
// Associates (co-teachers) are out of scope for this table — when added,
// they will live in a separate join table so this one stays "one primary
// teacher per cell".
@Entity({ name: 'programme_semester_subject_group_faculty' })
@Unique('UQ_pssgf_subject_group', [
  'programme_semester_subject_id',
  'attendance_group_id',
])
@Index('IDX_pssgf_programme_semester_subject_id', [
  'programme_semester_subject_id',
])
@Index('IDX_pssgf_attendance_group_id', ['attendance_group_id'])
@Index('IDX_pssgf_employee_id', ['employee_id'])
export class ProgrammeSemesterSubjectGroupFaculty {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_semester_subject_id: number;

  @ManyToOne(() => ProgrammeSemesterSubject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programme_semester_subject_id' })
  programme_semester_subject: ProgrammeSemesterSubject;

  @Column({ type: 'int' })
  attendance_group_id: number;

  @ManyToOne(() => AttendanceGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attendance_group_id' })
  attendance_group: AttendanceGroup;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
