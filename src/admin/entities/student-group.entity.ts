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
import { Student } from './student.entity';

// One row per student holding their group memberships — one column per group
// type. `attendance_group_id` is the first; `fee_group_id` and others slot in
// later as new kinds of groups are introduced. A null column means the
// student has not been placed in that kind of group yet.
@Entity({ name: 'student_groups' })
@Unique('UQ_student_groups_student_id', ['student_id'])
@Index('IDX_student_groups_attendance_group_id', ['attendance_group_id'])
export class StudentGroup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE', eager: true })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'int', nullable: true })
  attendance_group_id: number | null;

  @ManyToOne(() => AttendanceGroup, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'attendance_group_id' })
  attendance_group: AttendanceGroup | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
