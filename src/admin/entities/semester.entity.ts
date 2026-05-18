import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'semesters' })
@Unique('UQ_semesters_sem_number', ['sem_number'])
@Unique('UQ_semesters_code', ['code'])
export class Semester {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  sem_number: number;

  @Column({ type: 'varchar', length: 16 })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  // E.g. "1-1", "2-2" — year and semester within year.
  @Column({ type: 'varchar', length: 16 })
  year_sem_format: string;

  // E.g. "I", "II", "VIII" — roman numeral display.
  @Column({ type: 'varchar', length: 8 })
  roman_format: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
