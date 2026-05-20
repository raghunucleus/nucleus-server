import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Student } from '../../admin/entities/student.entity';

/**
 * Login credentials for a student, kept in a table separate from `students`.
 *
 * `students` is admin-owned data (bulk-uploaded, edited from the admin app);
 * keeping the password hash and the brute-force/lockout state out of it means
 * those columns are never touched by the student-management CRUD and the auth
 * subsystem owns its own row exclusively. One row per student (1:1).
 */
@Entity({ name: 'student_credentials' })
@Unique('UQ_student_credentials_student_id', ['student_id'])
@Unique('UQ_student_credentials_google_id', ['google_id'])
export class StudentCredential {
  @PrimaryGeneratedColumn()
  id: number;

  // FK to students.id — the owning student record.
  @Column({ type: 'int' })
  student_id: number;

  @OneToOne(() => Student, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'student_id' })
  student: Student;

  // Bcrypt hash. Null until the student (or an admin) first sets a password.
  @Column({ type: 'varchar', length: 255, nullable: true })
  password_hash: string | null;

  // Google OIDC subject ("sub" claim). Linked on the student's first Google
  // sign-in and required to match thereafter, so a Google-side email
  // reassignment can't be used to take over the account. Null for students
  // who never sign in with Google.
  @Column({ type: 'varchar', length: 64, nullable: true })
  google_id: string | null;

  // True after an admin-provisioned/reset password: the student must replace
  // it before the session is allowed to do anything else.
  @Column({ type: 'boolean', default: true })
  must_change_password: boolean;

  // Rolling count of consecutive failed logins. Reset to 0 on success or once
  // a lockout window elapses.
  @Column({ type: 'int', default: 0 })
  failed_login_attempts: number;

  // When set and in the future, login is refused regardless of credentials.
  @Column({ type: 'timestamp', nullable: true })
  locked_until: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  last_login_at: Date | null;

  // IPv4 or IPv6 of the most recent successful login — kept for audit.
  @Column({ type: 'varchar', length: 45, nullable: true })
  last_login_ip: string | null;

  @Column({ type: 'timestamp', nullable: true })
  password_changed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
