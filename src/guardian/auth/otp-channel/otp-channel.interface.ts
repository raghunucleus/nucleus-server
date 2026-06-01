import type { OtpChannelKey } from '../../entities/guardian-otp.entity';

/** Who an OTP is being sent to — derived from the mobile's contact rows. */
export interface OtpTarget {
  mobile_number: string;
  display_name: string;
  email: string | null;
}

/**
 * A delivery channel for guardian password OTPs. The auth service sends on the
 * first channel whose {@link canSend} is true. Adding WhatsApp later is a
 * one-line change to the OTP_CHANNELS provider — no flow change.
 */
export interface OtpChannel {
  readonly key: OtpChannelKey;
  canSend(target: OtpTarget): boolean;
  send(target: OtpTarget, otp: string, expiresInMinutes: number): Promise<void>;
}

/** DI token for the ordered list of active OTP channels. */
export const OTP_CHANNELS = Symbol('GUARDIAN_OTP_CHANNELS');
