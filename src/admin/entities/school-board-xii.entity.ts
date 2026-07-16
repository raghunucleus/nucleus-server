import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

// Deliberately a separate table from `school_boards_x` rather than one table with
// a level discriminator: most boards (CBSE, NIOS, MSBSHSE, …) issue both Class X
// and Class XII certificates, and a few issue them under different names — CISCE
// conducts ICSE at X and ISC at XII. The same `code` therefore has to exist in
// both lists with a different description, which a shared table with
// UQ(code) could not express.
@Entity({ name: 'school_boards_xii' })
@Unique('UQ_school_boards_xii_name', ['name'])
@Unique('UQ_school_boards_xii_code', ['code'])
export class SchoolBoardXii {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  // Which state/UT the board serves and which Class XII certificate it issues
  // (e.g. "Andhra Pradesh; conducts the Intermediate (Class XI–XII) public
  // examinations."). Free-form.
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
