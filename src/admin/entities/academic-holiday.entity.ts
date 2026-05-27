import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Admin } from './admin.entity';
import { AttendanceGroup } from './attendance-group.entity';
import { Employee } from './employee.entity';
import { Programme } from './programme.entity';

export type AcademicHolidayScope = 'institution' | 'programme' | 'group';
export type AcademicHolidayType =
  | 'public'
  | 'institutional'
  | 'unplanned'
  | 'half_day';

// A no-class day (or a range of days) that the session seeder honours so it
// never creates a class on that date. A mid-semester declaration also
// triggers mass-cancellation of already-scheduled sessions on matching dates.
//
// Scope picks the audience:
//   'institution' — affects every group on that date
//   'programme'   — limited to one programme (programme_id set)
//   'group'       — limited to one attendance group (attendance_group_id set)
//
// Multi-day breaks (Diwali, semester break) use `date` as the first day and
// `end_date` as the last. Single-day holidays leave `end_date` null.
@Entity({ name: 'academic_holidays' })
@Index('IDX_academic_holidays_date', ['date'])
@Index('IDX_academic_holidays_programme_id', ['programme_id'])
@Index('IDX_academic_holidays_attendance_group_id', ['attendance_group_id'])
export class AcademicHoliday {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  // 'institution' | 'programme' | 'group'. Enforced at the service layer
  // alongside the matching FK presence (scope='group' requires
  // attendance_group_id, etc.).
  @Column({ type: 'varchar', length: 16 })
  scope: AcademicHolidayScope;

  @Column({ type: 'int', nullable: true })
  programme_id: number | null;

  @ManyToOne(() => Programme, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'programme_id' })
  programme: Programme | null;

  @Column({ type: 'int', nullable: true })
  attendance_group_id: number | null;

  @ManyToOne(() => AttendanceGroup, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'attendance_group_id' })
  attendance_group: AttendanceGroup | null;

  // 'public' | 'institutional' | 'unplanned' | 'half_day'. Drives the
  // display badge; mid-semester declarations are usually 'unplanned'.
  @Column({ type: 'varchar', length: 32 })
  type: AcademicHolidayType;

  @Column({ type: 'varchar', length: 256, nullable: true })
  reason: string | null;

  // Exactly one of these two is set per row — enforced by a CHECK in the
  // migration. Holidays declared via the admin console stamp the admin id;
  // holidays declared by an HOD / principal via the employee app stamp the
  // employee id. Both are RESTRICT-protected so the declarer can't be
  // hard-deleted while their declarations live on.
  @Column({ type: 'int', nullable: true })
  declared_by_employee_id: number | null;

  @ManyToOne(() => Employee, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'declared_by_employee_id' })
  declared_by_employee: Employee | null;

  @Column({ type: 'int', nullable: true })
  declared_by_admin_id: number | null;

  @ManyToOne(() => Admin, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'declared_by_admin_id' })
  declared_by_admin: Admin | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
