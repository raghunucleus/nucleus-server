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
import { Department } from './department.entity';
import { Designation } from './designation.entity';

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

@Entity({ name: 'employees' })
@Unique('UQ_employees_emp_code', ['emp_code'])
@Unique('UQ_employees_email', ['email'])
@Unique('UQ_employees_country_code_mobile_number', ['country_code', 'mobile_number'])
@Index('IDX_employees_department_id', ['department_id'])
@Index('IDX_employees_designation_id', ['designation_id'])
@Index('IDX_employees_rm_emp_code', ['rm_emp_code'])
export class Employee {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  emp_code: string;

  @Column({ type: 'varchar', length: 128 })
  emp_display_name: string;

  // 'male' | 'female' | 'other' — enforced at the DTO layer.
  @Column({ type: 'varchar', length: 16 })
  gender: string;

  // Date of birth — optional. Stored as a bare date (no time/zone).
  @Column({ type: 'date', nullable: true })
  dob: string | null;

  @Column({ type: 'int' })
  department_id: number;

  @ManyToOne(() => Department, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @Column({ type: 'int' })
  designation_id: number;

  @ManyToOne(() => Designation, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'designation_id' })
  designation: Designation;

  @Column({ type: 'varchar', length: 20 })
  mobile_number: string;

  @Column({ type: 'varchar', length: 8, default: '91' })
  country_code: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  // Reporting manager's emp_code — self-FK to employees(emp_code), nullable so
  // top-of-hierarchy rows are allowed. CASCADE on update so renaming an
  // emp_code propagates to subordinates.
  @Column({ type: 'varchar', length: 32, nullable: true })
  rm_emp_code: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
