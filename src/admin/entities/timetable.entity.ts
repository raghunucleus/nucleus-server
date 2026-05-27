import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AttendanceGroup } from './attendance-group.entity';
import { ProgrammeSemester } from './programme-semester.entity';
import { TimetableCourse } from './timetable-course.entity';
import { TimetableEntry } from './timetable-entry.entity';
import { TimetablePeriod } from './timetable-period.entity';

// A weekly schedule template owned by one attendance group × programme
// semester. A group may have several templates ("Regular", "Exam week",
// "Diwali week"); the incharge picks which template to apply when
// publishing a given week. The schedule's "effective range" is the
// semester's planned dates (on ProgrammeSemester) and the existence of
// class_sessions for a week marks that week as published. There is no
// draft / published / archived status on the template itself.
@Entity({ name: 'timetables' })
@Index('IDX_timetables_programme_semester_id', ['programme_semester_id'])
@Index('IDX_timetables_attendance_group_id', ['attendance_group_id'])
export class Timetable {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_semester_id: number;

  @ManyToOne(() => ProgrammeSemester, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'programme_semester_id' })
  programme_semester: ProgrammeSemester;

  @Column({ type: 'int' })
  attendance_group_id: number;

  @ManyToOne(() => AttendanceGroup, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'attendance_group_id' })
  attendance_group: AttendanceGroup;

  @Column({ type: 'varchar', length: 96 })
  name: string;

  // The "go-to" template for this group. At most one row per (ps, group)
  // carries this flag — enforced by a partial unique index. The Schedule
  // view's preview modal auto-selects it so the common case ("Regular
  // week") needs no extra click.
  @Column({ type: 'boolean', default: false })
  is_default: boolean;

  // ISO weekday numbers the timetable runs on (1 = Mon … 7 = Sun).
  @Column({ type: 'jsonb', default: () => `'[1,2,3,4,5]'` })
  working_days: number[];

  // The bell schedule — period rows of the grid. Loaded explicitly by the
  // service (not eager) to avoid a cartesian blow-up with courses/entries.
  @OneToMany(() => TimetablePeriod, (p) => p.timetable)
  periods: TimetablePeriod[];

  // Subjects added exclusively to this timetable (on top of the semester's
  // linked subjects, which are read live from programme_semester_subjects).
  @OneToMany(() => TimetableCourse, (c) => c.timetable)
  courses: TimetableCourse[];

  // The filled grid cells — one per (day, period) that has a class.
  @OneToMany(() => TimetableEntry, (e) => e.timetable)
  entries: TimetableEntry[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
