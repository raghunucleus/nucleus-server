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
import { Student } from '../../admin/entities/student.entity';

export const GUARDIAN_RELATIONSHIPS = [
  'father',
  'mother',
  'guardian',
  'other',
] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

/**
 * A parent/guardian *contact* for one student. Guardians are intentionally NOT
 * modelled as a global identity: there is no `guardians` table and no
 * cross-student dedup. The same person (same mobile number) can be the
 * 'father' of one student and the 'guardian' of another — those are simply two
 * independent rows here. This is the only place guardian details live.
 *
 * Login is keyed by `mobile_number`: a parent signs in with their number and
 * sees every student where that number appears here. Auth state for that
 * number lives in `guardian_credentials` (also keyed by mobile, not by a row
 * id here).
 */
@Entity({ name: 'student_guardians' })
@Unique('UQ_student_guardians_student_id_relationship', [
  'student_id',
  'relationship',
])
@Index('IDX_student_guardians_mobile_number', ['mobile_number'])
@Index('IDX_student_guardians_student_id', ['student_id'])
export class StudentGuardian {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // 'father' | 'mother' | 'guardian' | 'other' — enforced at the DTO layer.
  // Unique per student (one father, one mother, …) so a re-upload upserts.
  @Column({ type: 'varchar', length: 16 })
  relationship: string;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  // Indian mobile number, no country code. The login key — indexed, but NOT
  // unique (the same number is a contact on many students).
  @Column({ type: 'varchar', length: 16 })
  mobile_number: string;

  // Optional; only used to deliver the password OTP.
  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'boolean', default: false })
  is_primary: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
