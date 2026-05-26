import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { Role } from './role.entity';

/**
 * The assignment of a composed role to a specific employee. Per-screen
 * attribute values for the assignment live on `role_assignment_attributes`.
 *
 * One assignment per employee — assigning a new role to an employee replaces
 * any existing assignment (the prior row + its attributes are dropped via the
 * cascade FK). Revoking an assignment hard-deletes the row; there is no
 * soft-deactivate state.
 */
@Entity({ name: 'role_assignments' })
@Unique('UQ_role_assignments_employee_id', ['employee_id'])
@Index('IDX_role_assignments_role_id', ['role_id'])
export class RoleAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  role_id: number;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  // The admin who created the assignment — kept for audit, nullable so a
  // future system-generated assignment doesn't fight the FK.
  @Column({ type: 'int', nullable: true })
  assigned_by_admin_id: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
