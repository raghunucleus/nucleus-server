import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { RoleAssignment } from './role-assignment.entity';

/**
 * A per-(assignment × screen × attribute) value. The `screen_key` and
 * `attribute_key` are string FKs into the static catalog. The value shape
 * depends on the attribute's `multi` flag:
 *   - multi=false → a single id-like primitive (number/string)
 *   - multi=true  → an array of id-like primitives
 * The application validates the shape against the catalog at write time.
 */
@Entity({ name: 'role_assignment_attributes' })
@Unique('UQ_raa_assignment_screen_attribute', [
  'role_assignment_id',
  'screen_key',
  'attribute_key',
])
@Index('IDX_raa_assignment_id', ['role_assignment_id'])
export class RoleAssignmentAttribute {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  role_assignment_id: number;

  @ManyToOne(() => RoleAssignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_assignment_id' })
  role_assignment: RoleAssignment;

  @Column({ type: 'varchar', length: 128 })
  screen_key: string;

  @Column({ type: 'varchar', length: 64 })
  attribute_key: string;

  @Column({ type: 'jsonb' })
  value: unknown;
}
