import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AttendanceGroup } from './attendance-group.entity';
import { Employee } from './employee.entity';
import { Student } from './student.entity';

// Effective-dated record of which attendance group a student belonged to over
// time. Every transfer inserts one row (with `effective_to` on the previous
// row closed) so we can answer "which group was Alice in on 2026-07-10?"
// even when student_groups carries only the current mapping.
//
// The current row has `effective_to = NULL`. Initial assignments also live
// here so the history is gap-free.
@Entity({ name: 'student_group_history' })
@Index('IDX_sg_history_student_id', ['student_id'])
@Index('IDX_sg_history_attendance_group_id', ['attendance_group_id'])
@Index('IDX_sg_history_effective_from', ['effective_from'])
export class StudentGroupHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // NULL means "unassigned" for that period — a placeholder we don't expect
  // to write but the column allows so partial states are representable.
  @Column({ type: 'int', nullable: true })
  attendance_group_id: number | null;

  @ManyToOne(() => AttendanceGroup, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'attendance_group_id' })
  attendance_group: AttendanceGroup | null;

  @Column({ type: 'date' })
  effective_from: string;

  // NULL = current row.
  @Column({ type: 'date', nullable: true })
  effective_to: string | null;

  // NULL for the initial seeded assignment (no human triggered it).
  @Column({ type: 'int', nullable: true })
  changed_by_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'changed_by_employee_id' })
  changed_by: Employee | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  reason: string | null;

  @CreateDateColumn()
  created_at: Date;
}
