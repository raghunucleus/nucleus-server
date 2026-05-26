import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A composed role — assembled by an admin from one or more catalog role types
 * plus a chosen subset of those role types' screens. The role is a *template*:
 * the per-screen attribute values that make it actionable for a specific
 * employee live on `role_assignments` / `role_assignment_attributes`.
 */
@Entity({ name: 'roles' })
@Unique('UQ_roles_code', ['code'])
@Unique('UQ_roles_name', ['name'])
@Index('IDX_roles_is_active', ['is_active'])
export class Role {
  @PrimaryGeneratedColumn()
  id: number;

  // Short, stable identifier the admin types — used in URLs, exports, and to
  // disambiguate roles that share similar display names. Case-insensitive
  // uniqueness is enforced in the service layer (mirroring `name`).
  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Role type keys from the static catalog, e.g. ['hod', 'teacher']. Drives the
  // pool of screens the role can include but does not itself grant access.
  @Column({ type: 'jsonb' })
  role_type_keys: string[];

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
