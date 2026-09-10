import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const SESSION_AUDIENCES = ['student', 'employee', 'guardian'] as const;
export type SessionAudience = (typeof SESSION_AUDIENCES)[number];

/** Why a session was ended. Stamped once; rows are never hard-deleted early. */
export type SessionRevokedReason =
  | 'user' // the owner signed this device out (My devices, or logout)
  | 'admin' // an admin force-signed it out
  | 'password_changed' // the owner changed their password on another device
  | 'password_reset' // reset link / OTP / accepted invite set a new password
  | 'admin_password_reset' // an admin reset or set the password
  | 'device_limit' // signed out from the at-limit login picker
  | 'replaced' // the same device logged in again; this row was superseded
  | 'reuse_detected' // a rotated-out refresh token was replayed
  | 'deactivated' // the account was deactivated
  | 'access_removed'; // a parent's mobile no longer belongs to any student

/**
 * One signed-in device of a student, employee or parent. The row's `id`
 * travels in both JWTs as the `sid` claim, which is what makes a login
 * addressable: listable on "My devices", killable one at a time, countable
 * against the device limit, and skippable ("all except current") on a
 * password change.
 *
 * Polymorphic like `account_invites`: `subject_id` is `students.id`,
 * `employees.id` or `guardian_credentials.id` depending on `audience`, so
 * there is no FK. Students and employees are never hard-deleted and guardian
 * credentials never are either; an orphan would only age out via the cleanup
 * cron.
 *
 * `refresh_jti` holds the CURRENT refresh token's id and rotates on every
 * refresh — presenting any other jti (outside the short grace window for the
 * previous one) burns the session as `reuse_detected`. `revoked_at` is set,
 * never deleted.
 *
 * Same-device replacement is backstopped by the PARTIAL unique index
 * `UQ_auth_sessions_audience_subject_id_device_id` (live rows with a
 * device_id), which has no decorator here: Postgres has no partial UNIQUE
 * *constraint*, so it can only be created in the migration
 * (1797300000000-CreateAuthSessions.ts).
 */
@Entity({ name: 'auth_sessions' })
@Check(
  'CHK_auth_sessions_audience',
  `"audience" IN ('student', 'employee', 'guardian')`,
)
@Index('IDX_auth_sessions_audience_subject_id', ['audience', 'subject_id'], {
  where: '"revoked_at" IS NULL',
})
@Index('IDX_auth_sessions_expires_at', ['expires_at'])
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  audience: SessionAudience;

  @Column({ type: 'int' })
  subject_id: number;

  /**
   * Client-minted persistent id (localStorage on web, AsyncStorage on
   * mobile). The same device logging in again REPLACES its live session
   * instead of burning a second slot. NULL for clients that never sent one.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  device_id: string | null;

  /**
   * Human label: the mobile apps send one ("Pixel 7 · Android 14"); for web
   * it is parsed from the user-agent ("Chrome 130 on Windows").
   */
  @Column({ type: 'varchar', length: 128, default: 'Unknown device' })
  device_name: string;

  /** Raw login address, refreshed on rotation. Admin-visible only. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  user_agent: string | null;

  /** The CURRENT refresh token's jti; rotates on refresh, NULLed on revoke. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  refresh_jti: string | null;

  /**
   * The jti rotated out by the LAST refresh, honoured for
   * `ROTATION_GRACE_SECONDS` after `rotated_at` so the loser of a concurrent
   * refresh converges on the current token instead of burning the session.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  prev_refresh_jti: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rotated_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  /** Stamped on every refresh — "last active" on My devices. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  last_used_at: Date;

  /** Mirrors the refresh token's lifetime; rolls forward on each rotation. */
  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  revoked_reason: SessionRevokedReason | null;
}
