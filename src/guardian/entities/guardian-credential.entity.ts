import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Login auth-state for a parent, keyed by **mobile number** (not by any
 * guardian identity — there is no guardians table). One row per distinct mobile
 * that has set a password. The set of students the number can view is derived
 * at request time from `student_guardians` rows with the same mobile.
 */
@Entity({ name: 'guardian_credentials' })
@Unique('UQ_guardian_credentials_mobile_number', ['mobile_number'])
export class GuardianCredential {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 16 })
  mobile_number: string;

  // Bcrypt hash. Null until the parent first sets a password via OTP (or an
  // admin sets one directly).
  @Column({ type: 'varchar', length: 255, nullable: true })
  password_hash: string | null;

  // True only after an admin set-password fallback. OTP-set passwords leave it
  // false.
  @Column({ type: 'boolean', default: false })
  must_change_password: boolean;

  @Column({ type: 'int', default: 0 })
  failed_login_attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  locked_until: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  last_login_at: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  last_login_ip: string | null;

  @Column({ type: 'timestamp', nullable: true })
  password_changed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
