import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Employee } from './employee.entity';
import { ProgrammeSemester } from './programme-semester.entity';
import { Student } from './student.entity';
import { Subject } from './subject.entity';

export type AttendanceAdjustmentSource = 'od' | 'medical' | 'manual_correction';

// Ledger of direct attendance bumps applied outside the session-marking flow
// (HOD adds OD for a student who missed classes for an event, medical leave,
// retroactive correction). Keeping these as deltas — rather than inserting
// fake attendance rows — keeps class_session_attendance honest about what
// teachers actually marked.
//
// Dashboard reads the rollup row plus the SUM of these deltas to render the
// final %.
//
//   subject_id NULL — applied to overall attendance only (rare; e.g. an
//                     institutional OD for an event spanning every subject's
//                     day). When NULL, only the overall % moves.
//   subject_id set  — applied to that subject specifically.
@Entity({ name: 'attendance_adjustments' })
@Index('IDX_att_adjustments_student_ps', [
  'student_id',
  'programme_semester_id',
])
@Index('IDX_att_adjustments_subject_id', ['subject_id'])
@Index('IDX_att_adjustments_effective_date', ['effective_date'])
export class AttendanceAdjustment {
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

  // NULL = applied to overall only; set = scoped to one master subject.
  @Column({ type: 'int', nullable: true })
  subject_id: number | null;

  @ManyToOne(() => Subject, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject | null;

  // Usually positive (granting attendance for an absence).
  @Column({ type: 'int', default: 0 })
  attended_delta: number;

  // Usually 0; negative if a session was retroactively voided for this
  // student so the denominator shrinks too.
  @Column({ type: 'int', default: 0 })
  held_delta: number;

  @Column({ type: 'varchar', length: 32 })
  source: AttendanceAdjustmentSource;

  @Column({ type: 'varchar', length: 256 })
  reason: string;

  @Column({ type: 'date' })
  effective_date: string;

  @Column({ type: 'int' })
  approved_by_employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'approved_by_employee_id' })
  approved_by: Employee;

  @CreateDateColumn()
  created_at: Date;
}
