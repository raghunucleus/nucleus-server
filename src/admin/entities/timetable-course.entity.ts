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
import { Subject } from './subject.entity';
import { Timetable } from './timetable.entity';
import { TimetableCourseFaculty } from './timetable-course-faculty.entity';

// A subject added exclusively to one timetable — beyond the subjects already
// linked to the semester. Either it references a master-catalog subject
// (subject_id set) or it is a free-text activity (custom_label set, e.g.
// "Library", "Sports", "Mentoring") — never both. Service-enforced.
//
// Faculty for these courses are mapped here, exclusive to the timetable;
// semester-linked subjects instead reuse their programme_semester_subject
// faculty allocation.
@Entity({ name: 'timetable_courses' })
@Index('IDX_timetable_courses_timetable_id', ['timetable_id'])
export class TimetableCourse {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  timetable_id: number;

  @ManyToOne(() => Timetable, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'timetable_id' })
  timetable: Timetable;

  @Column({ type: 'int', nullable: true })
  subject_id: number | null;

  @ManyToOne(() => Subject, {
    onDelete: 'RESTRICT',
    eager: true,
    nullable: true,
  })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject | null;

  // Used only when subject_id is null — a free-text course name.
  @Column({ type: 'varchar', length: 96, nullable: true })
  custom_label: string | null;

  // Faculty allocated to this course, exclusive to the timetable. Loaded via
  // an explicit leftJoin in the service.
  @OneToMany(() => TimetableCourseFaculty, (f) => f.timetable_course)
  faculty: TimetableCourseFaculty[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
