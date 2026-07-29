import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';

/**
 * Join row making an employee an approver of one approval action.
 *
 * The pool is flat: any assigned approver can act, there is no order or quorum.
 * Assignment is global — an approver of `corporate_relations.company` approves
 * every company, not a department's slice.
 *
 * `action_key` is a plain string validated against the static catalog in
 * `approval-actions.ts` rather than an FK to a lookup table: the catalog can't
 * drift from the keys the code references, and reading approvers never needs a
 * join. The composite unique doubles as the index for the hot path ("who
 * approves action X"), so no separate `action_key` index is needed; the
 * `employee_id` index serves the reverse lookup.
 */
@Entity({ name: 'approval_action_approvers' })
@Unique('UQ_approval_action_approvers_action_employee', [
  'action_key',
  'employee_id',
])
@Index('IDX_approval_action_approvers_employee_id', ['employee_id'])
export class ApprovalActionApprover {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64 })
  action_key: string;

  @Column({ type: 'int' })
  employee_id: number;

  // Non-eager to avoid a cycle with Employee.department (which is eager).
  // CASCADE so deleting the employee drops their approver links rather than
  // leaving dangling rows.
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  /**
   * Reserved for future sequential approval chains (L1 → L2 → …). Always 1
   * today and read by nothing — the pool is flat.
   */
  @Column({ type: 'smallint', default: 1 })
  level: number;

  @CreateDateColumn()
  created_at: Date;
}
