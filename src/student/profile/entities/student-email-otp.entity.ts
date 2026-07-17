import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Student } from '../../../admin/entities/student.entity';

/**
 * A one-time password verifying a student's PERSONAL email address — the
 * OTP_VERIFY edit policy, where verification IS the approval gate (no
 * approver). Mirrors guardian_otps: SHA-256 of the 6-digit code only,
 * single-use, short-lived, attempt-capped; request rate limits live in Redis.
 * `email` is the NEW address the code was sent to; a successful verify
 * promotes it to `students.personal_email`.
 */
@Entity({ name: 'student_email_otps' })
@Index('IDX_student_email_otps_student_id', ['student_id'])
@Index('IDX_student_email_otps_expires_at', ['expires_at'])
export class StudentEmailOtp {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  student_id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 64 })
  otp_hash: string;

  @Column({ type: 'timestamp' })
  expires_at: Date;

  @Column({ type: 'int', default: 0 })
  attempt_count: number;

  @Column({ type: 'timestamp', nullable: true })
  consumed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}
