import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'entrance_exams' })
@Unique('UQ_entrance_exams_name', ['name'])
@Unique('UQ_entrance_exams_code', ['code'])
export class EntranceExam {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  // Admission context (e.g. "For first-year B.Tech admissions"). Free-form —
  // the exam's role in admissions is descriptive, not a modelled relationship.
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
