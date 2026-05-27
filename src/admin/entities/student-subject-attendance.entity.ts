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
import { ProgrammeSemester } from './programme-semester.entity';
import { Student } from './student.entity';
import { Subject } from './subject.entity';

// Per (student × semester × subject) rollup that powers the dashboard. One
// row is upserted inside the attendance-marking transaction so per-subject %
// reads are a single PK lookup.
//
//   attended_count — completed sessions where the student was 'present' or
//                    'late' PLUS attended_delta from attendance_adjustments
//                    (computed at read time; not stored on this row).
//   held_count    — completed sessions the student was on the roster for,
//                    minus held_delta where adjustments voided some.
//
// 'subject_id' here is the master subjects.id — the same dimension whether
// the session was delivered as a regular subject or via an elective option.
// Cancelled sessions never increment `held_count`, so they self-correct any
// % automatically.
@Entity({ name: 'student_subject_attendance' })
@Unique('UQ_ssa_student_ps_subject', [
  'student_id',
  'programme_semester_id',
  'subject_id',
])
@Index('IDX_ssa_student_id', ['student_id'])
@Index('IDX_ssa_subject_id', ['subject_id'])
export class StudentSubjectAttendance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'int' })
  programme_semester_id: number;

  @ManyToOne(() => ProgrammeSemester, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'programme_semester_id' })
  programme_semester: ProgrammeSemester;

  @Column({ type: 'int' })
  subject_id: number;

  @ManyToOne(() => Subject, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'int', default: 0 })
  attended_count: number;

  @Column({ type: 'int', default: 0 })
  held_count: number;

  @Column({ type: 'timestamp', nullable: true })
  last_session_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
