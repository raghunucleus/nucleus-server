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
import { Employee } from '../../../admin/entities/employee.entity';

/**
 * A named snapshot of one Insights screen's address — tab, scope narrowing
 * and the screen's own filters — owned by one employee. See the migration
 * `CreateEmployeeSavedViews` for the rationale; `InsightsViewsService` is the
 * only writer and filters every read by the acting employee.
 */
@Entity({ name: 'employee_saved_views' })
@Unique('UQ_employee_saved_views_employee_id_screen_key_name', [
  'employee_id',
  'screen_key',
  'name',
])
@Index('IDX_employee_saved_views_employee_id', ['employee_id'])
export class EmployeeSavedView {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  // One of the `insights.*` catalog keys — validated at the DTO layer.
  @Column({ type: 'varchar', length: 64 })
  screen_key: string;

  // The screen's `web_route` at save time, so the client never has to map.
  @Column({ type: 'varchar', length: 128 })
  route: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  // Query string without the leading `?`.
  @Column({ type: 'text', default: '' })
  search: string;

  @Column({ type: 'boolean', default: false })
  is_pinned: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
