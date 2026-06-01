import { Injectable, NotImplementedException } from '@nestjs/common';
import type { OtpChannel, OtpTarget } from './otp-channel.interface';

/**
 * WhatsApp OTP delivery — the eventual *primary* channel (every parent has a
 * mobile number). Stub for now: implement `send`, then add this provider ahead
 * of EmailOtpChannel in OTP_CHANNELS. Not registered today.
 */
@Injectable()
export class WhatsappOtpChannel implements OtpChannel {
  readonly key = 'whatsapp' as const;

  canSend(_target: OtpTarget): boolean {
    return true;
  }

  async send(
    _target: OtpTarget,
    _otp: string,
    _expiresInMinutes: number,
  ): Promise<void> {
    throw new NotImplementedException(
      'WhatsApp OTP delivery is not yet available.',
    );
  }
}
