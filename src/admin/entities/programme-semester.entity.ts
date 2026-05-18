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

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
