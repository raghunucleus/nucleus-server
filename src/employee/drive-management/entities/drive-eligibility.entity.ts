import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Programme } from '../../../admin/entities/programme.entity';
import { Drive } from './drive.entity';

/**
 * Who a drive is open to — one row per drive (drive-level; there is no
 * per-designation eligibility). Edited independently of the create/edit form,
 * from the drive detail screen's Eligibility tab.
 *
 * Every dimension is a filter: an empty array (or a null threshold) means "no
 * restriction on this axis". The multi-value axes that map to fixed enums
 * (entry type, gender) or bare years (passout) are stored as Postgres arrays;
 * programmes reference the master table via a join, like the drive's other
 * multi-select classifiers.
 *
 * Postgres returns `numeric` as a string, typed as such here per the codebase
 * convention (see `Drive`).
 */
@Entity({ name: 'drive_eligibility' })
@Unique('UQ_drive_eligibility_drive_id', ['drive_id'])
export class DriveEligibility {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  drive_id: number;

  @OneToOne(() => Drive, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'drive_id' })
  drive: Drive;

  // Entry types (1 = Regular, 2 = Lateral), per students.entry_type.
  @Column({ type: 'smallint', array: true, default: () => "'{}'" })
  entry_types: number[];

  // Genders (male / female / other), per students.gender.
  @Column({ type: 'varchar', array: true, default: () => "'{}'" })
  genders: string[];

  // Graduating years the drive accepts, matched against students.pass_out_year.
  @Column({ type: 'int', array: true, default: () => "'{}'" })
  passout_years: number[];

  @Column({ type: 'boolean', default: false })
  allow_backlog_history: boolean;

  // Max current backlogs allowed. NULL = no limit imposed on this axis.
  @Column({ type: 'int', nullable: true })
  max_current_backlogs: number | null;

  // Academic minimums. Xth / 12th-or-Diploma are percentages; Btech is a
  // 10-point CGPA. NULL = no minimum on that stage.
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  min_tenth_percentage: string | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  min_twelfth_or_diploma_percentage: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  min_btech_cgpa: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  /** Programmes the drive is open to — empty means all programmes. */
  @ManyToMany(() => Programme)
  @JoinTable({
    name: 'drive_eligible_programmes_link',
    joinColumn: { name: 'drive_eligibility_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'programme_id', referencedColumnName: 'id' },
  })
  eligible_programmes: Programme[];
}
