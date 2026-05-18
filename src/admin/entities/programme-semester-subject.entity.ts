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
import { ProgrammeSemesterSubjectOption } from './programme-semester-subject-option.entity';
import { Subject } from './subject.entity';

// A row represents EITHER a real subject offered in this batch's semester
// (subject_id set, placeholder_name null) OR an unfilled open-elective slot
// the student will later choose to fill (subject_id null, placeholder_name
// set, e.g. "Open Elective 1"; with a candidate-subject pool via `options`).
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

  // Used only for elective slots (subject_id is null). For real subjects we
  // read the name off the joined `subject` row.
  @Column({ type: 'varchar', length: 64, nullable: true })
  placeholder_name: string | null;

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

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
