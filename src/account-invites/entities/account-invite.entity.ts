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
import { Admin } from '../../admin/entities/admin.entity';

export const INVITE_SUBJECT_TYPES = ['employee', 'student'] as const;
export type InviteSubjectType = (typeof INVITE_SUBJECT_TYPES)[number];

/**
 * An account invitation: the single-use "set your password" link an admin
 * sends so a newly created employee or student can bootstrap their own login
 * without a temporary password ever travelling by email.
 *
 * One polymorphic table rather than the mirrored-per-audience shape used by
 * `employee_credentials` / `student_credentials`. Those mirror because they are
 * 1:1 rows read on every login by two genuinely divergent auth services. An
 * invite is 1:N history with no audience-specific column at all, written and
 * read by exactly one admin feature — splitting it would duplicate the entity,
 * the migration, the consume transaction, the bulk-send loop and the status
 * query for no schema divergence.
 *
 * The trade-off is that `subject_id` carries no foreign key. That is safe here
 * because neither admin controller exposes a DELETE (records are deactivated,
 * never removed), and `acceptInvite` re-loads the subject inside the consume
 * transaction anyway, so a stray row can never mint a session.
 *
 * Rows are never deleted. A superseded or revoked invite stays for the audit
 * trail; `revoked_at` is what makes it dead.
 */
@Entity({ name: 'account_invites' })
@Unique('UQ_account_invites_token_hash', ['token_hash'])
@Index('IDX_account_invites_subject_type_subject_id', [
  'subject_type',
  'subject_id',
])
@Index('IDX_account_invites_expires_at', ['expires_at'])
export class AccountInvite {
  @PrimaryGeneratedColumn()
  id: number;

  // Which audience `subject_id` points at. A CHECK constraint in the migration
  // pins the allowed values, since there is no FK to do it.
  @Column({ type: 'varchar', length: 16 })
  subject_type: InviteSubjectType;

  // employees.id or students.id, per subject_type. Intentionally FK-less.
  @Column({ type: 'int' })
  subject_id: number;

  // Snapshot of the address this invite actually went to. The person's record
  // email can be edited afterwards; the audit trail must show where this
  // particular link landed, not where a later one would.
  @Column({ type: 'varchar', length: 255 })
  email: string;

  // sha256(token) as lowercase hex. The plaintext token exists only in the
  // outbound email, so a database dump can never be replayed into a login.
  @Column({ type: 'varchar', length: 64 })
  token_hash: string;

  @Column({ type: 'timestamp' })
  expires_at: Date;

  // Set exactly once, by the conditional UPDATE that consumes the token.
  @Column({ type: 'timestamp', nullable: true })
  accepted_at: Date | null;

  // Set when superseded by a resend, when an admin sets a password
  // out-of-band, or when the invite email failed to send.
  @Column({ type: 'timestamp', nullable: true })
  revoked_at: Date | null;

  // 0 on the first invite to this person, +1 on each subsequent send.
  @Column({ type: 'int', default: 0 })
  resend_count: number;

  @Column({ type: 'int', nullable: true })
  invited_by_admin_id: number | null;

  @ManyToOne(() => Admin, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'invited_by_admin_id' })
  invited_by_admin: Admin | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
