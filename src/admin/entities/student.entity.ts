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
import { Country } from './country.entity';
import { DiplomaBoard } from './diploma-board.entity';
import { District } from './district.entity';
import { EntranceExam } from './entrance-exam.entity';
import { Programme } from './programme.entity';
import { SchoolBoardX } from './school-board-x.entity';
import { SchoolBoardXii } from './school-board-xii.entity';
import { State } from './state.entity';

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
// Per-programme, not global: a re-admitted student (B.Tech → M.Tech) is a
// second row with the same Aadhaar — same rationale as the non-unique mobile.
@Unique('UQ_students_programme_id_aadhaar_number', [
  'programme_id',
  'aadhaar_number',
])
@Index('IDX_students_programme_id', ['programme_id'])
@Index('IDX_students_admission_year_id', ['admission_year_id'])
@Index('IDX_students_mobile_number', ['mobile_number'])
@Index('IDX_students_pass_out_year', ['pass_out_year'])
// Student-search engine hot paths (migration 1794500000000).
@Index('IDX_students_ug_cgpa', ['ug_cgpa'])
@Index('IDX_students_current_backlogs', ['current_backlogs'])
@Index('IDX_students_display_name', ['display_name'])
@Index('IDX_students_programme_id_admission_year_id', [
  'programme_id',
  'admission_year_id',
])
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

  // ---------------------------------------------------------------------------
  // Extended profile — filled in AFTER onboarding (by the student through the
  // approval/OTP flows, or directly by an admin). Everything below is nullable
  // or defaulted so the create + bulk-upload paths stay 9-field. The per-field
  // student edit policy lives in src/student/profile/profile-fields.ts.
  // ---------------------------------------------------------------------------

  // Name split. The Aadhaar-matching full name is display_name (NOT a new
  // column — it predates the split and is used everywhere: ID card, chat, lists).
  @Column({ type: 'varchar', length: 64, nullable: true })
  first_name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  middle_name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  last_name: string | null;

  // Personal email, distinct from the college email (`email`). Written ONLY by
  // the OTP verify flow (student) or an admin; `personal_email_pending` stages
  // the unverified address while an OTP is in flight.
  @Column({ type: 'varchar', length: 255, nullable: true })
  personal_email: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  personal_email_pending: string | null;

  // Cached: admission_years.year + degrees.duration_years. Lateral entrants
  // graduate with their batch, so entry_type never shifts this. Recomputed when
  // programme/admission year (or the degree's duration) changes; consumed by
  // placements without joins.
  @Column({ type: 'int', nullable: true })
  pass_out_year: number | null;

  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  tenth_percentage: string | null;

  // Regular entrants only (lateral students enter via diploma).
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  twelfth_percentage: string | null;

  // Lateral entrants only.
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true })
  diploma_percentage: string | null;

  // Synced from student_cgpa on every marks commit (10-point scale). A student
  // may raise a change request, but the next marks upload overwrites it.
  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  ug_cgpa: string | null;

  @Column({ type: 'int', nullable: true })
  current_backlogs: number | null;

  // Sticky: flips true when the student has EVER had a backlog; never auto-clears.
  @Column({ type: 'boolean', default: false })
  backlog_history: boolean;

  // The student's resume: an externally-hosted link (Drive, personal site, …)
  // they supply and maintain. Handed to recruiters raw, never proxied — we
  // deliberately don't host resume files, so hosting/availability is theirs.
  @Column({ type: 'varchar', length: 512, nullable: true })
  resume_external_url: string | null;

  // Flat parent/guardian contacts (profile truth). Mirrored on every write into
  // the two FIXED student_guardians rows — (student_id,'parent') and
  // (student_id,'default_guardian') — which power the parent-portal login.
  @Column({ type: 'varchar', length: 128, nullable: true })
  parent_name: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  parent_mobile: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  parent_email: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  guardian_name: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  guardian_mobile: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  guardian_email: string | null;

  @Column({ type: 'text', nullable: true })
  home_address: string | null;

  @Column({ type: 'int', nullable: true })
  home_district_id: number | null;

  @ManyToOne(() => District, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'home_district_id' })
  home_district: District | null;

  @Column({ type: 'varchar', length: 6, nullable: true })
  home_pincode: string | null;

  @Column({ type: 'int', nullable: true })
  home_state_id: number | null;

  @ManyToOne(() => State, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'home_state_id' })
  home_state: State | null;

  @Column({ type: 'int', nullable: true })
  home_country_id: number | null;

  @ManyToOne(() => Country, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'home_country_id' })
  home_country: Country | null;

  // Exactly 12 digits; unique when present (NULLs don't collide).
  @Column({ type: 'varchar', length: 12, nullable: true })
  aadhaar_number: string | null;

  // Stored uppercased (DTO transform), standard PAN shape AAAAA9999A.
  @Column({ type: 'varchar', length: 10, nullable: true })
  pan_number: string | null;

  // Entrance exam is a dependency group. N/A is an explicit boolean — never a
  // magic rank value. Invariant (enforced in DTOs): na=true ⇒ rank/exam/year NULL.
  @Column({ type: 'boolean', default: false })
  entrance_exam_na: boolean;

  @Column({ type: 'int', nullable: true })
  entrance_exam_rank: number | null;

  @Column({ type: 'int', nullable: true })
  entrance_exam_id: number | null;

  @ManyToOne(() => EntranceExam, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entrance_exam_id' })
  entrance_exam: EntranceExam | null;

  @Column({ type: 'smallint', nullable: true })
  entrance_exam_year: number | null;

  // Gap pair: reason required (in DTOs) only when year_of_gap > 0.
  @Column({ type: 'smallint', nullable: true })
  year_of_gap: number | null;

  @Column({ type: 'text', nullable: true })
  reason_of_gap: string | null;

  @Column({ type: 'int', nullable: true })
  tenth_board_id: number | null;

  @ManyToOne(() => SchoolBoardX, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenth_board_id' })
  tenth_board: SchoolBoardX | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tenth_institution: string | null;

  @Column({ type: 'smallint', nullable: true })
  tenth_year_of_pass: number | null;

  @Column({ type: 'int', nullable: true })
  tenth_state_id: number | null;

  @ManyToOne(() => State, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'tenth_state_id' })
  tenth_state: State | null;

  // 12th block — Regular entrants only (hidden for lateral).
  @Column({ type: 'int', nullable: true })
  twelfth_board_id: number | null;

  @ManyToOne(() => SchoolBoardXii, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'twelfth_board_id' })
  twelfth_board: SchoolBoardXii | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  twelfth_institution: string | null;

  @Column({ type: 'smallint', nullable: true })
  twelfth_year_of_pass: number | null;

  @Column({ type: 'int', nullable: true })
  twelfth_state_id: number | null;

  @ManyToOne(() => State, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'twelfth_state_id' })
  twelfth_state: State | null;

  // Diploma block — Lateral entrants only (hidden for regular).
  @Column({ type: 'int', nullable: true })
  diploma_board_id: number | null;

  @ManyToOne(() => DiplomaBoard, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'diploma_board_id' })
  diploma_board: DiplomaBoard | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  diploma_institution: string | null;

  @Column({ type: 'smallint', nullable: true })
  diploma_year_of_pass: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  diploma_specialization: string | null;

  @Column({ type: 'int', nullable: true })
  diploma_state_id: number | null;

  @ManyToOne(() => State, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'diploma_state_id' })
  diploma_state: State | null;

  // Placement flags — default true (a student is assumed allowed by dept and
  // interested until explicitly set otherwise). Still nullable so an admin can
  // clear the value; allowed_by_dept_for_placements is ADMIN_ONLY (read-only to
  // the student).
  @Column({ type: 'boolean', nullable: true, default: true })
  allowed_by_dept_for_placements: boolean | null;

  @Column({ type: 'boolean', nullable: true, default: true })
  interested_in_placements_self: boolean | null;

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
