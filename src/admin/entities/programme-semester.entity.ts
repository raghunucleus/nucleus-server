import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AdmissionYear } from './admission-year.entity';
import { Programme } from './programme.entity';
import { Semester } from './semester.entity';

export type ProgrammeSemesterStatus = 'upcoming' | 'ongoing' | 'completed';

@Entity({ name: 'programme_semesters' })
@Unique('UQ_programme_semesters_programme_admission_year_semester', [
  'programme_id',
  'admission_year_id',
  'semester_id',
])
export class ProgrammeSemester {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  programme_id: number;

  @ManyToOne(() => Programme, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'programme_id' })
  programme: Programme;

  @Column({ type: 'int' })
  admission_year_id: number;

  @ManyToOne(() => AdmissionYear, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'admission_year_id' })
  admission_year: AdmissionYear;

  @Column({ type: 'int' })
  semester_id: number;

  @ManyToOne(() => Semester, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'semester_id' })
  semester: Semester;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  // Lifecycle state of the semester for this batch. New rows start as
  // 'upcoming'; the admin moves them forward to 'ongoing' and 'completed'
  // (see ProgrammeSemestersService.setStatus for the allowed transitions).
  @Column({ type: 'varchar', length: 16, default: 'upcoming' })
  status: ProgrammeSemesterStatus;

  // Academic calendar boundaries for this batch's semester. The session
  // seeder uses planned_end_date as the hard upper bound — sessions are
  // never created past it, regardless of what a timetable's effective_to
  // says. Both nullable for migration compatibility; admins should fill
  // them when creating / activating a semester so the seeder has a real
  // cap instead of the 1-year safety horizon.
  @Column({ type: 'date', nullable: true })
  planned_start_date: string | null;

  @Column({ type: 'date', nullable: true })
  planned_end_date: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
