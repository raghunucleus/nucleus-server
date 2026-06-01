import { Injectable } from '@nestjs/common';
import { MailService } from '../../../mail/mail.service';
import type { OtpChannel, OtpTarget } from './otp-channel.interface';

/**
 * Delivers the OTP by email. Usable only when an email is on file for the
 * mobile (from one of its contact rows). In dev the email lands in
 * `dev_mail_outbox`, so the code is testable.
 */
@Injectable()
export class EmailOtpChannel implements OtpChannel {
  readonly key = 'email' as const;

  constructor(private readonly mail: MailService) {}

  canSend(target: OtpTarget): boolean {
    return !!target.email;
  }

  async send(
    target: OtpTarget,
    otp: string,
    expiresInMinutes: number,
  ): Promise<void> {
    if (!target.email) return;
    await this.mail.sendGuardianOtp({
      to: target.email,
      displayName: target.display_name,
      otp,
      expiresInMinutes,
    });
  }
}
