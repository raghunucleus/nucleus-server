import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Employee } from '../../../admin/entities/employee.entity';
import type { EmployeeNotificationModuleKey } from '../employee-notification.types';

/**
 * A per-employee, per-module mute for the OS-push and email channels.
 *
 * OVERRIDES ONLY: a missing row means both channels are on. A fresh employee
 * therefore has zero rows and receives everything, and the table only grows
 * when someone actually mutes something — so the fan-out lookup in `send` stays
 * a single small query no matter how many employees exist.
 *
 * There is no in-app column on purpose: in-app IS the notification list, and a
 * notification that lands nowhere visible is indistinguishable from a bug.
 */
@Entity({ name: 'employee_notification_preferences' })
@Unique('UQ_employee_notification_preferences_employee_id_module_key', [
  'employee_id',
  'module_key',
])
export class EmployeeNotificationPreference {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  employee_id: number;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee: Employee;

  // Stable module key (see EmployeeNotificationModuleKey) — plain varchar so a
  // new module needs no migration, matching the notifications table.
  @Column({ type: 'varchar', length: 32 })
  module_key: EmployeeNotificationModuleKey;

  @Column({ type: 'boolean', default: true })
  email_enabled: boolean;

  @Column({ type: 'boolean', default: true })
  push_enabled: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
