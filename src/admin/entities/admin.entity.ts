import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'admins' })
@Unique('UQ_admins_username', ['username'])
@Unique('UQ_admins_email', ['email'])
@Unique('UQ_admins_google_id', ['google_id'])
export class Admin {
  @PrimaryGeneratedColumn()
  id: string;

  @Column({ type: 'varchar', length: 64 })
  username: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  password_hash: string;

  @Column({ type: 'boolean', default: false })
  is_master_admin: boolean;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  first_name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  last_name: string | null;

  // Dial code without the leading '+' (e.g. '91', '1', '253').
  @Column({ type: 'varchar', length: 8, nullable: true })
  country_code: string | null;

  // Local subscriber number only — no country prefix.
  @Column({ type: 'varchar', length: 16, nullable: true })
  mobile_number: string | null;

  // Cached, derived from first_name + last_name. Maintained via lifecycle hooks
  // and a fallback DB trigger on raw inserts (see migration).
  @Column({ type: 'varchar', length: 129, nullable: true })
  display_name: string | null;

  // Base32-encoded TOTP shared secret. Null until the admin has begun enrolment.
  @Column({ type: 'varchar', length: 64, nullable: true })
  totp_secret: string | null;

  // Set once the admin verifies their first TOTP code. Null while the secret
  // is still pending verification or after the admin disables 2FA.
  @Column({ type: 'timestamp', nullable: true })
  totp_enabled_at: Date | null;

  // Google OIDC subject identifier ("sub" claim). Linked on first successful
  // Google sign-in for an existing admin record; remains null for admins who
  // only authenticate with username/password.
  @Column({ type: 'varchar', length: 64, nullable: true })
  google_id: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @BeforeInsert()
  @BeforeUpdate()
  syncDisplayName(): void {
    const parts = [this.first_name, this.last_name]
      .map((p) => (p ?? '').trim())
      .filter((p) => p.length > 0);
    this.display_name = parts.length > 0 ? parts.join(' ') : null;
  }
}
