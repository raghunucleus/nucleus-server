import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

// Bodies that award the 3-year polytechnic diploma used for lateral entry into
// 2nd year B.Tech. Not always a "board" in the strict sense — some states award
// through a directorate (DTE) and three through a technical university (GTU,
// RGPV, CSVTU) — but from a student record's point of view they are all just the
// authority named on the diploma.
@Entity({ name: 'diploma_boards' })
@Unique('UQ_diploma_boards_name', ['name'])
@Unique('UQ_diploma_boards_code', ['code'])
export class DiplomaBoard {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  // Which state/UT the body serves and what it awards. Free-form.
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
