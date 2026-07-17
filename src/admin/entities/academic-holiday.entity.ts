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
import { Employee } from './employee.entity';

export type AcademicHolidayType = 'public' | 'institutional' | 'unplanned';

// A no-class day (or a range of days) that the session seeder honours so it
// never creates a class on that date. A mid-semester declaration also
// triggers mass-cancellation of already-scheduled sessions on matching dates.
// Holidays are always institution-wide — every group on the date is affected.
//
// Multi-day breaks (Diwali, semester break) use `date` as the first day and
// `end_date` as the last. Single-day holidays leave `end_date` null.
@Entity({ name: 'academic_holidays' })
@Index('IDX_academic_holidays_date', ['date'])
export class AcademicHoliday {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'date', nullable: true })
  end_date: string | null;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  // 'public' | 'institutional' | 'unplanned'. Drives the display badge;
  // mid-semester declarations are usually 'unplanned'.
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
