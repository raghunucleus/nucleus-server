import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'school_boards_x' })
@Unique('UQ_school_boards_x_name', ['name'])
@Unique('UQ_school_boards_x_code', ['code'])
export class SchoolBoardX {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  // Which state/UT the board serves and which Class X certificate it issues
  // (e.g. "Andhra Pradesh; conducts the SSC (Class X) public examination.").
  // Free-form — the board's jurisdiction is descriptive, not a modelled
  // relationship to the address attributes.
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
