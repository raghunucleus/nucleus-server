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
import { TimetableCourse } from './timetable-course.entity';

// One row per (timetable-exclusive course, faculty) pair. A course may be
// taught by several faculty; the unique constraint only stops the same
// faculty being linked to the same course twice.
@Entity({ name: 'timetable_course_faculty' })
@Unique('UQ_ttc_faculty_course_employee', [
  'timetable_course_id',
  'employee_id',
])
@Index('IDX_ttc_faculty_course_id', ['timetable_course_id'])
@Index('IDX_ttc_faculty_employee_id', ['employee_id'])
export class TimetableCourseFaculty {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  timetable_course_id: number;

  @ManyToOne(() => TimetableCourse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'timetable_course_id' })
  timetable_course: TimetableCourse;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  @CreateDateColumn()
  created_at: Date;
}
