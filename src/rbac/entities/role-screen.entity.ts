import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Role } from './role.entity';

/**
 * A screen included in a composed role, plus the actions granted on it. The
 * `screen_key` is a string FK into the static RBAC catalog — there is no
 * `screens` table because the catalog lives in code (see src/rbac/catalog/).
 */
@Entity({ name: 'role_screens' })
@Unique('UQ_role_screens_role_id_screen_key', ['role_id', 'screen_key'])
@Index('IDX_role_screens_role_id', ['role_id'])
export class RoleScreen {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  role_id: number;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ type: 'varchar', length: 128 })
  screen_key: string;

  // Subset of the screen's ScreenDef.actions that this role grants. Stored as
  // jsonb so the application owns the shape — the catalog validates membership.
  @Column({ type: 'jsonb' })
  allowed_actions: string[];

  // Subset of the screen's ScreenDef.platforms this role grants. The runtime
  // intersects this with the catalog so values not on the catalog screen are
  // silently dropped — but the validator rejects them at save time so the
  // admin sees an error rather than a silent mismatch. At least one platform
  // is required.
  @Column({ type: 'jsonb' })
  allowed_platforms: string[];
}
