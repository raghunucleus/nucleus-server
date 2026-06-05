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

// How the student entered the programme. Stored as a small integer in the DB
// (1 = Regular, 2 = Lateral) — enforced at the DTO layer.
export const ENTRY_TYPES = [1, 2] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  1: 'Regular',
  2: 'Lateral',
};

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

  // Entry type: 1 = Regular, 2 = Lateral — enforced at the DTO layer.
  @Column({ type: 'smallint', default: 1 })
  entry_type: number;

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

  // Object-storage key of the student's ID-card photo (S3/MinIO), e.g.
  // "student-photos/<uuid>.jpg". A random UUID — never the roll number — so the
  // key is not enumerable or derivable from any public identifier. The bytes are
  // served to clients only via short-lived presigned URLs; this column never
  // holds a public URL. Null when no photo has been uploaded.
  @Column({ type: 'text', nullable: true })
  photo_key: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  // Birthday hidden from peers. A dedicated boolean (not in
  // hidden_profile_fields) because it's filtered in the set-based classmate
  // birthdays query — keep the predicate sargable. Default false = visible.
  @Column({ type: 'boolean', default: false })
  birthday_hidden: boolean;

  // Mobile number hidden from peers. Its own column (not hidden_profile_fields)
  // because it's the one field hidden BY DEFAULT (sensitive PII) — default true
  // = hidden; a student opts in to show it.
  @Column({ type: 'boolean', default: true })
  mobile_hidden: boolean;

  // Other personal field keys this student has hidden from peer viewers
  // (photo/email/mobile/blood_group/gender). Read only on the single-student
  // peer profile. Empty (default) = everything visible; only hidden keys stored.
  @Column({ type: 'jsonb', default: () => `'[]'` })
  hidden_profile_fields: string[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
