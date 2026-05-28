import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Singleton row (id = 1) holding institution-wide branding shown on the student
// ID card and other documents: college name, address, logo, affiliation codes.
// The admin UI edits the single row; there is never more than one. Kept as a
// table (not env config) so admins can change branding without a redeploy.
@Entity({ name: 'institution_settings' })
export class InstitutionSetting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 256 })
  name: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  short_name: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  address_line1: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  address_line2: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  pincode: string | null;

  // Publicly reachable URL of the college logo shown in the card header.
  @Column({ type: 'text', nullable: true })
  logo_url: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  affiliation_code: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  aicte_code: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  naac_grade: string | null;

  // Free-text note printed at the foot of the card (e.g. "If found, return to…").
  @Column({ type: 'varchar', length: 256, nullable: true })
  card_footer_note: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
