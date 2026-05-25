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

export type TimetableStatus = 'draft' | 'published' | 'archived';

// A weekly class schedule for one attendance group within one
// programme-semester. Effective dates let several timetables exist for the
// same group × semester — a current one plus future-dated revisions — so the
// schedule can be planned ahead. Among *published* timetables of the same
// group × semester the effective ranges must not overlap (service-enforced);
// drafts may overlap freely.
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

  // PG `date` — TypeORM hands these back as 'YYYY-MM-DD' strings.
  @Column({ type: 'date' })
  effective_from: string;

  // Null means open-ended (runs until superseded by a later timetable).
  @Column({ type: 'date', nullable: true })
  effective_to: string | null;

  // 'draft' | 'published' | 'archived'. Only published timetables count
  // towards the no-overlap rule; archived timetables are read-only.
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: TimetableStatus;

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
