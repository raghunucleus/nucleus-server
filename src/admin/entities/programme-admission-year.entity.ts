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
import { Regulation } from './regulation.entity';

@Entity({ name: 'programme_admission_years' })
// One row per (programme, admission year) batch. Today it carries the
// regulation that applies to the batch; future per-batch attributes live here
// too. To change a batch's regulation, edit the row rather than creating a new
// one.
@Unique('UQ_programme_admission_years_programme_admission_year', [
  'programme_id',
  'admission_year_id',
])
export class ProgrammeAdmissionYear {
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
  regulation_id: number;

  @ManyToOne(() => Regulation, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'regulation_id' })
  regulation: Regulation;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
