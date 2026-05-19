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
import { AdmissionYear } from './admission-year.entity';
import { Programme } from './programme.entity';

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

@Entity({ name: 'students' })
@Unique('UQ_students_student_id', ['student_id'])
@Unique('UQ_students_email', ['email'])
@Unique('UQ_students_abc_id', ['abc_id'])
@Index('IDX_students_programme_id', ['programme_id'])
@Index('IDX_students_admission_year_id', ['admission_year_id'])
@Index('IDX_students_mobile_number', ['mobile_number'])
export class Student {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  student_id: string;

  @Column({ type: 'int' })
  programme_id: number;

  @ManyToOne(() => Programme, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'programme_id' })
  programme: Programme;

  @Column({ type: 'int' })
  admission_year_id: number;

  @ManyToOne(() => AdmissionYear, { onDelete: 'RESTRICT', eager: true })
  @JoinColumn({ name: 'admission_year_id' })
  admission_year: AdmissionYear;

  @Column({ type: 'varchar', length: 128 })
  display_name: string;

  // 'male' | 'female' | 'other' — enforced at the DTO layer.
  @Column({ type: 'varchar', length: 16 })
  gender: string;

  @Column({ type: 'date' })
  dob: string;

  // Blood group enum (A+/A-/B+/B-/AB+/AB-/O+/O-) — enforced at the DTO layer.
  @Column({ type: 'varchar', length: 8, nullable: true })
  blood_group: string | null;

  // Academic Bank of Credits ID — 12-digit number, unique when present.
  // Postgres UNIQUE allows multiple NULLs so the constraint is safe on a nullable column.
  @Column({ type: 'varchar', length: 16, nullable: true })
  abc_id: string | null;

  // Indian mobile number, no country code. Not unique: a student may rejoin
  // (e.g. as an M.Tech candidate after B.Tech) with the same number.
  @Column({ type: 'varchar', length: 16 })
  mobile_number: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
