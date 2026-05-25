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
import { Employee } from './employee.entity';

@Entity({ name: 'departments' })
@Unique('UQ_departments_name', ['name'])
@Unique('UQ_departments_code', ['code'])
@Unique('UQ_departments_short_name', ['short_name'])
@Index('IDX_departments_hod_employee_id', ['hod_employee_id'])
export class Department {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  short_name: string;

  @Column({ type: 'int', nullable: true })
  hod_employee_id: number | null;

  // Non-eager to avoid a cycle with Employee.department (which is eager).
  @ManyToOne(() => Employee, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'hod_employee_id' })
  hod: Employee | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
