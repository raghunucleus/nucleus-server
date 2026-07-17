import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Employee } from '../../../admin/entities/employee.entity';
import type {
  EmployeeNotificationModuleKey,
  NotificationTarget,
} from '../employee-notification.types';

@Entity({ name: 'employee_notifications' })
// (employee_id, created_at) covers the paginated list read (filter by employee,
// order/seek newest first). (employee_id, read_at) serves the unread-count
// query (WHERE employee_id = ? AND read_at IS NULL).
@Index('IDX_employee_notifications_employee_id_created_at', [
  'employee_id',
  'created_at',
])
@Index('IDX_employee_notifications_employee_id_read_at', [
  'employee_id',
  'read_at',
])
export class EmployeeNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  // Stable module key (see EmployeeNotificationModuleKey). Plain varchar, not a
  // Postgres enum, so adding a module never needs a migration.
  @Column({ type: 'varchar', length: 32 })
  module: EmployeeNotificationModuleKey;

  // Sub-kind within the module (e.g. 'profile_update-raised') — drives client icon.
  @Column({ type: 'varchar', length: 64 })
  type: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  // Opaque navigation metadata: the server writes it once and reads it back
  // whole; clients interpret it via their own route registry. JSONB so new
  // target shapes need no migration.
  @Column({ type: 'jsonb', nullable: true })
  target: NotificationTarget | null;

  @Column({ type: 'timestamptz', nullable: true })
  read_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}
