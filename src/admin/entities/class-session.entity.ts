import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AttendanceGroup } from './attendance-group.entity';
import { Employee } from './employee.entity';
import { ProgrammeSemester } from './programme-semester.entity';
import { ProgrammeSemesterSubject } from './programme-semester-subject.entity';
import { ProgrammeSemesterSubjectOption } from './programme-semester-subject-option.entity';
import { Subject } from './subject.entity';
import { TimetableEntry } from './timetable-entry.entity';
import { TimetablePeriod } from './timetable-period.entity';

export type ClassSessionStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'rescheduled';

// One actual class on one actual date. Seeded from a published timetable's
// cells when the programme semester is 'ongoing'; can also be inserted
// ad-hoc by the group incharge for makeup / extra classes.
//
// Shape varies by what the cell carries:
//
//  Regular subject in one group:
//    attendance_group_id  = the group
//    programme_semester_subject_id = the real PSS (subject_id is set on it)
//    programme_semester_subject_option_id = NULL
//    subject_id = the master subject taught (denormalised from PSS.subject_id)
//
//  Elective cohort (per-group OR cross-group, controlled by PSS.cohort_scope):
//    attendance_group_id  = the group   (cohort_scope='group')
//                         OR NULL       (cohort_scope='programme_semester')
//    programme_semester_subject_id = the SLOT PSS (subject_id NULL on it)
//    programme_semester_subject_option_id = the chosen option
//    subject_id = the option's master subject
//
// Whichever way, `subject_id` is the rollup dimension: a student's percentage
// for "Python" sums over every session keyed on Python's subject_id, no
// matter which slot or cohort delivered it.
//
// scheduled_employee_id is fixed at seeding. effective_employee_id starts
// equal to it and gets overwritten when a substitute fills in — the rollup
// keys on the subject, not the teacher, so subs land in the right bucket.
@Entity({ name: 'class_sessions' })
@Index('IDX_class_sessions_group_date', [
  'attendance_group_id',
  'session_date',
])
@Index('IDX_class_sessions_ps_date', ['programme_semester_id', 'session_date'])
@Index('IDX_class_sessions_teacher_date', [
  'effective_employee_id',
  'session_date',
])
@Index('IDX_class_sessions_subject_date', ['subject_id', 'session_date'])
@Index('IDX_class_sessions_status', ['status'])
@Index('IDX_class_sessions_timetable_entry_id', ['timetable_entry_id'])
export class ClassSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  session_date: string;

  // ISO weekday (1 = Mon … 7 = Sun). Denormalised for fast day-grouped reads
  // (teacher's "my week") without re-deriving from session_date.
  @Column({ type: 'smallint' })
  day_of_week: number;

  @Column({ type: 'int' })
  programme_semester_id: number;

  @ManyToOne(() => ProgrammeSemester, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'programme_semester_id' })
  programme_semester: ProgrammeSemester;

  // NULL only for cross-group elective cohort sessions
  // (PSS.cohort_scope='programme_semester').
  @Column({ type: 'int', nullable: true })
  attendance_group_id: number | null;

  @ManyToOne(() => AttendanceGroup, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'attendance_group_id' })
  attendance_group: AttendanceGroup | null;

  @Column({ type: 'int' })
  timetable_period_id: number;

  @ManyToOne(() => TimetablePeriod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'timetable_period_id' })
  timetable_period: TimetablePeriod;

  // How many consecutive periods this session occupies, anchored at
  // timetable_period_id. 1 for a normal class; >1 for a lab. Mirrors the
  // source timetable_entry's span at seed time so attendance is marked once
  // for the whole run, not per-period.
  @Column({ type: 'smallint', default: 1 })
  span: number;

  // NULL when the session was inserted ad-hoc (makeup / extra class).
  @Column({ type: 'int', nullable: true })
  timetable_entry_id: number | null;

  @ManyToOne(() => TimetableEntry, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'timetable_entry_id' })
  timetable_entry: TimetableEntry | null;

  @Column({ type: 'int' })
  programme_semester_subject_id: number;

  @ManyToOne(() => ProgrammeSemesterSubject, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'programme_semester_subject_id' })
  programme_semester_subject: ProgrammeSemesterSubject;

  // Set only for elective cohort sessions.
  @Column({ type: 'int', nullable: true })
  programme_semester_subject_option_id: number | null;

  @ManyToOne(() => ProgrammeSemesterSubjectOption, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'programme_semester_subject_option_id' })
  programme_semester_subject_option: ProgrammeSemesterSubjectOption | null;

  // The actual master subject delivered by this session. Denormalised from
  // either PSS.subject_id (regulars) or option.subject_id (electives) — kept
  // here so the rollup table can key on a single column and per-subject % is
  // a PK lookup, not a multi-join.
  @Column({ type: 'int' })
  subject_id: number;

  @ManyToOne(() => Subject, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  @Column({ type: 'int' })
  scheduled_employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'scheduled_employee_id' })
  scheduled_employee: Employee;

  @Column({ type: 'int' })
  effective_employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'effective_employee_id' })
  effective_employee: Employee;

  // 'scheduled' | 'completed' | 'cancelled' | 'rescheduled'. Only completed
  // sessions count toward `held` in student_subject_attendance.
  @Column({ type: 'varchar', length: 16, default: 'scheduled' })
  status: ClassSessionStatus;

  // For a 'rescheduled' session — points at the new session row that
  // replaces it. The original stays in the table for audit.
  @Column({ type: 'int', nullable: true })
  rescheduled_to_session_id: number | null;

  @ManyToOne(() => ClassSession, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'rescheduled_to_session_id' })
  rescheduled_to_session: ClassSession | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  cancel_reason: string | null;

  @Column({ type: 'varchar', length: 48, nullable: true })
  room: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  note: string | null;

  // Stamped the first time attendance is saved on this session. Used to
  // distinguish "never marked" from "marked then re-edited" so the rollup's
  // `held` doesn't double-increment on amendments.
  @Column({ type: 'timestamp', nullable: true })
  attendance_marked_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
