import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ProgrammeSemesterSubject } from './programme-semester-subject.entity';
import { ProgrammeSemesterSubjectOptionFaculty } from './programme-semester-subject-option-faculty.entity';
import { Subject } from './subject.entity';

// One row per (elective slot, candidate subject) pair. The slot itself lives
// on `programme_semester_subjects` (where subject_id is null and
// placeholder_name carries the slot's label).
//
// Real subjects never have option rows — only elective slots do.
@Entity({ name: 'programme_semester_subject_options' })
@Unique('UQ_pss_options_entry_subject', [
  'programme_semester_subject_id',
  'subject_id',
])
export class ProgrammeSemesterSubjectOption {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_semester_subject_id: number;

  @ManyToOne(() => ProgrammeSemesterSubject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'programme_semester_subject_id' })
  programme_semester_subject: ProgrammeSemesterSubject;

  @Column({ type: 'int' })
  subject_id: number;

  @ManyToOne(() => Subject, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;

  // Faculty allocated to teach this candidate subject. Loaded via an explicit
  // leftJoin, like the rest of the programme-semester-subject graph.
  @OneToMany(
    () => ProgrammeSemesterSubjectOptionFaculty,
    (f) => f.programme_semester_subject_option,
  )
  faculty: ProgrammeSemesterSubjectOptionFaculty[];

  @CreateDateColumn()
  created_at: Date;
}
