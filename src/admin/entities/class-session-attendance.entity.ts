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
import { ClassSession } from './class-session.entity';
import { Employee } from './employee.entity';
import { Student } from './student.entity';

export type ClassSessionAttendanceStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'exempt'
  | 'od'
  | 'leave';

// One row per (session, student) once attendance has been marked. The unique
// constraint makes the marking endpoint trivially idempotent — a retry from
// a flaky mobile network upserts the same row.
//
// 'present' and 'late' both count toward `attended` in the rollup;
// 'absent' / 'exempt' / 'od' / 'leave' don't. 'od' here means a student-level
// OD recorded against the session itself (rare); broader OD adjustments are
// tracked on attendance_adjustments instead. 'leave' is a SANCTIONED absence:
// the student has an approved leave (student_leaves) covering the session
// date — held, not attended, so the percentage math is identical to 'absent';
// only the label differs. Marking writes it automatically for students on
// effective leave (teacher may still override to 'present'), and approving a
// leave after the fact flips existing 'absent' rows in range to 'leave'.
@Entity({ name: 'class_session_attendance' })
@Unique('UQ_class_session_attendance_session_student', [
  'class_session_id',
  'student_id',
])
@Index('IDX_class_session_attendance_student_id', ['student_id'])
@Index('IDX_class_session_attendance_class_session_id', ['class_session_id'])
export class ClassSessionAttendance {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  class_session_id: number;

  @ManyToOne(() => ClassSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'class_session_id' })
  class_session: ClassSession;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'varchar', length: 16 })
  status: ClassSessionAttendanceStatus;

  @Column({ type: 'timestamp' })
  marked_at: Date;

  @Column({ type: 'int' })
  marked_by_employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'marked_by_employee_id' })
  marked_by: Employee;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
