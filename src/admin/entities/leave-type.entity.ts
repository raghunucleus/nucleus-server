import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Admin-managed master list of leave categories a student picks from when
 * applying for leave (Sick, Medical, Personal, …). Soft-deactivated, never
 * deleted: `student_leaves.leave_type_id` is RESTRICT, so history keeps its
 * label. Only active rows are offered to students.
 */
@Entity({ name: 'leave_types' })
@Unique('UQ_leave_types_name', ['name'])
@Unique('UQ_leave_types_code', ['code'])
export class LeaveType {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
