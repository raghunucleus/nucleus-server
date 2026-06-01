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

// Per (student × semester × subject) rollup that powers the dashboard. It is a
// pure projection of class_session_attendance: the attendance-marking
// transaction recomputes the affected rows from those marked rows (not via
// incremental deltas), so the cache can never drift out of sync. Per-subject %
// reads stay a single PK lookup.
//
//   attended_count — completed sessions where the student was 'present' or
//                    'late'. Read-time, attended_delta from
//                    attendance_adjustments is added on top (NOT stored here).
//   held_count    — completed sessions the student was on the roster for
//                    (= the count of their class_session_attendance rows on
//                    completed sessions). Read-time held_delta is added on top.
//
// Because attended/held are both projected from the same rows, attended_count
// <= held_count always holds — enforced by CHECK constraint
// CHK_ssa_attended_le_held (migration 1781800000000). Adjustments, which can
// legitimately push the *displayed* % past 100, live in attendance_adjustments
// and are never written to this table.
//
// 'subject_id' here is the master subjects.id — the same dimension whether
// the session was delivered as a regular subject or via an elective option.
// Cancelled sessions never count toward `held_count`, so they self-correct any
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
