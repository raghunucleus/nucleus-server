import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const OTP_CHANNEL_KEYS = ['email', 'whatsapp'] as const;
export type OtpChannelKey = (typeof OTP_CHANNEL_KEYS)[number];

/**
 * A one-time password used to bootstrap or reset a parent's login password,
 * keyed by **mobile number** (no guardian identity). SHA-256 of the 6-digit
 * code only, single-use, short-lived, attempt-capped. Per-mobile/IP request
 * rate limits live in Redis.
 */
@Entity({ name: 'guardian_otps' })
@Index('IDX_guardian_otps_mobile_number', ['mobile_number'])
@Index('IDX_guardian_otps_expires_at', ['expires_at'])
export class GuardianOtp {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 16 })
  mobile_number: string;

  @Column({ type: 'varchar', length: 64 })
  otp_hash: string;

  @Column({ type: 'varchar', length: 16 })
  channel: string;

  @Column({ type: 'timestamp' })
  expires_at: Date;

  @Column({ type: 'int', default: 0 })
  attempt_count: number;

  @Column({ type: 'timestamp', nullable: true })
  consumed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}
