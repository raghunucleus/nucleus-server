import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProgrammeSemester } from './programme-semester.entity';
import { ProgrammeSemesterSubjectGroupFaculty } from './programme-semester-subject-group-faculty.entity';
import { ProgrammeSemesterSubjectOption } from './programme-semester-subject-option.entity';
import { Subject } from './subject.entity';

export const PROGRAMME_SEMESTER_SUBJECT_SLOT_TYPES = [
  'open_elective',
  'honors',
  'minors',
] as const;

export type ProgrammeSemesterSubjectSlotType =
  (typeof PROGRAMME_SEMESTER_SUBJECT_SLOT_TYPES)[number];

// A row represents EITHER a real subject offered in this batch's semester
// (subject_id set, placeholder_name + slot_type null) OR an unfilled slot
// the student will later choose to fill (subject_id null, placeholder_name
// + slot_type set; with a candidate-subject pool via `options`). slot_type
// is one of 'open_elective' | 'honors' | 'minors' — same shape, different
// category for downstream consumers / display.
//
// The partial unique index on (programme_semester_id, subject_id) WHERE
// subject_id IS NOT NULL stops the same real subject being added twice to
// one semester.
@Entity({ name: 'programme_semester_subjects' })
export class ProgrammeSemesterSubject {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_semester_id: number;

  @ManyToOne(() => ProgrammeSemester, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'programme_semester_id' })
  programme_semester: ProgrammeSemester;

  @Column({ type: 'int', nullable: true })
  subject_id: number | null;

  @ManyToOne(() => Subject, { onDelete: 'RESTRICT', eager: true, nullable: true })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject | null;

  // Used only for slot rows (subject_id is null). For real subjects we
  // read the name off the joined `subject` row.
  @Column({ type: 'varchar', length: 64, nullable: true })
  placeholder_name: string | null;

  // Slot category — null for real-subject rows; one of 'open_elective',
  // 'honors', 'minors' for slot rows. The DB enforces this pairing via
  // CHK_pss_slot_type_with_placeholder.
  @Column({ type: 'varchar', length: 16, nullable: true })
  slot_type: ProgrammeSemesterSubjectSlotType | null;

  // Numeric with a single decimal place — covers integer credits (3, 4) and
  // half-credit subjects (1.5, 0.5).
  @Column({ type: 'numeric', precision: 4, scale: 1 })
  credits: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  // Candidate subjects for an open-elective slot. Empty for real-subject
  // entries. Not eager-loaded — the query builder pulls them with an
  // explicit leftJoin to keep the response shape predictable.
  @OneToMany(
    () => ProgrammeSemesterSubjectOption,
    (o) => o.programme_semester_subject,
  )
  options: ProgrammeSemesterSubjectOption[];

  // Per-group faculty cells. One row per (subject, attendance group) — a
  // single teacher per cell. Loaded via an explicit leftJoin from the
  // faculty-matrix endpoint; not eager-loaded here.
  @OneToMany(
    () => ProgrammeSemesterSubjectGroupFaculty,
    (f) => f.programme_semester_subject,
  )
  group_faculty: ProgrammeSemesterSubjectGroupFaculty[];

  // Virtual (non-DB) field populated by the list endpoint when the caller
  // passes attendanceGroupId — carries the single teacher allocated to this
  // subject for the requested group (0 or 1 element). Lets the timetable
  // editor scope its palette without a second round-trip.
  faculty?: ProgrammeSemesterSubjectGroupFaculty[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
