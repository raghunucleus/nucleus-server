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
import { Employee } from './employee.entity';
import { ProgrammeSemesterSubject } from './programme-semester-subject.entity';
import { Timetable } from './timetable.entity';
import { TimetableCourse } from './timetable-course.entity';
import { TimetablePeriod } from './timetable-period.entity';

// One filled cell of a timetable's grid — the class held on a given weekday
// in a given period. A cell teaches EITHER a semester-linked subject
// (programme_semester_subject_id set) OR a timetable-exclusive course
// (timetable_course_id set) — never both, never neither. Service-enforced.
//
// employee_id is the specific teacher chosen for the cell; it stays null
// until one is picked. The unique constraint keeps one class per cell.
@Entity({ name: 'timetable_entries' })
// (timetable_id, day_of_week, timetable_period_id) — one class per cell.
@Unique('UQ_timetable_entries_timetable_day_period', [
  'timetable_id',
  'day_of_week',
  'timetable_period_id',
])
@Index('IDX_timetable_entries_timetable_id', ['timetable_id'])
@Index('IDX_timetable_entries_employee_id', ['employee_id'])
export class TimetableEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  timetable_id: number;

  @ManyToOne(() => Timetable, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'timetable_id' })
  timetable: Timetable;

  // ISO weekday (1 = Mon … 7 = Sun). Always a member of the timetable's
  // working_days.
  @Column({ type: 'smallint' })
  day_of_week: number;

  @Column({ type: 'int' })
  timetable_period_id: number;

  @ManyToOne(() => TimetablePeriod, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'timetable_period_id' })
  timetable_period: TimetablePeriod;

  // How many consecutive periods this class occupies on its day. 1 for a
  // normal class; >1 merges periods (e.g. a lab). The entry is anchored at
  // timetable_period_id — the first period of the run.
  @Column({ type: 'smallint', default: 1 })
  span: number;

  @Column({ type: 'int', nullable: true })
  programme_semester_subject_id: number | null;

  @ManyToOne(() => ProgrammeSemesterSubject, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'programme_semester_subject_id' })
  programme_semester_subject: ProgrammeSemesterSubject | null;

  @Column({ type: 'int', nullable: true })
  timetable_course_id: number | null;

  @ManyToOne(() => TimetableCourse, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'timetable_course_id' })
  timetable_course: TimetableCourse | null;

  @Column({ type: 'int', nullable: true })
  employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  room: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  note: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
