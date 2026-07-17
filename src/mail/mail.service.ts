import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import sgMail from '@sendgrid/mail';
import { Repository } from 'typeorm';
import { DevMailOutbox } from './entities/dev-mail-outbox.entity';

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Thin SendGrid wrapper with two non-production fallbacks:
 *
 * - NODE_ENV=dev: nothing is sent. Every email is written to the
 *   `dev_mail_outbox` table so temporary passwords and reset links can be
 *   read straight from the database.
 * - Otherwise, if SENDGRID_API_KEY is unset: the email is logged.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly isDev: boolean;
  private readonly enabled: boolean;
  private readonly from: { email: string; name: string };

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DevMailOutbox)
    private readonly devOutbox: Repository<DevMailOutbox>,
  ) {
    this.isDev = this.config.get<string>('NODE_ENV') === 'dev';
    const apiKey = this.config.get<string>('SENDGRID_API_KEY');
    // Real delivery only happens outside dev with a key configured.
    this.enabled = !!apiKey && !this.isDev;

    if (this.enabled) {
      sgMail.setApiKey(apiKey as string);
      this.from = {
        email: this.config.getOrThrow<string>('MAIL_FROM'),
        name: this.config.get<string>('MAIL_FROM_NAME', 'Nucleus'),
      };
    } else {
      this.from = { email: 'no-reply@localhost', name: 'Nucleus' };
      if (this.isDev) {
        this.logger.warn(
          'NODE_ENV=dev — emails are stored in dev_mail_outbox, not sent.',
        );
      } else {
        this.logger.warn(
          'SENDGRID_API_KEY is not set — emails will be logged, not delivered.',
        );
      }
    }
  }

  async send(options: SendMailOptions): Promise<void> {
    if (this.isDev) {
      await this.storeInDevOutbox(options);
      return;
    }

    if (!this.enabled) {
      this.logger.log(
        `[mail suppressed] to=${options.to} subject="${options.subject}"`,
      );
      this.logger.debug(options.text);
      return;
    }

    try {
      await sgMail.send({
        to: options.to,
        from: this.from,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
    } catch (err) {
      // Never surface SendGrid internals to the caller; log and rethrow a
      // generic failure so controllers can decide how to handle it.
      this.logger.error(
        `Failed to send email to ${options.to}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      throw new Error('Email delivery failed');
    }
  }

  /** Persist an email to the dev outbox table instead of sending it. */
  private async storeInDevOutbox(options: SendMailOptions): Promise<void> {
    try {
      await this.devOutbox.save(
        this.devOutbox.create({
          to_address: options.to,
          subject: options.subject,
          body_text: options.text,
          body_html: options.html,
        }),
      );
      this.logger.log(
        `[dev mail] stored in dev_mail_outbox: to=${options.to} subject="${options.subject}"`,
      );
    } catch (err) {
      // Most likely the migration hasn't run yet — fall back to logging so the
      // flow still completes and the content is recoverable.
      this.logger.warn(
        `Could not write to dev_mail_outbox (${
          err instanceof Error ? err.message : 'unknown error'
        }); logging the email instead.`,
      );
      this.logger.log(
        `[dev mail] to=${options.to} subject="${options.subject}"\n${options.text}`,
      );
    }
  }

  /**
   * Sent when an admin provisions or resets a student's login. The temporary
   * password is single-use in spirit — the student is forced to replace it on
   * first login.
   */
  async sendStudentTempPassword(params: {
    to: string;
    displayName: string;
    studentId: string;
    tempPassword: string;
    loginUrl: string;
  }): Promise<void> {
    const subject = 'Your Nucleus student login';
    const text = [
      `Hello ${params.displayName},`,
      '',
      'A login has been created for your Nucleus student account.',
      '',
      `Student ID: ${params.studentId}`,
      `Temporary password: ${params.tempPassword}`,
      '',
      `Sign in here: ${params.loginUrl}`,
      '',
      'For your security you will be asked to set a new password the first',
      'time you sign in. Do not share these credentials with anyone.',
      '',
      'If you did not expect this email, contact your institution immediately.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject,
      text,
      html: wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>A login has been created for your Nucleus student account.</p>
         <table cellpadding="0" cellspacing="0" style="margin:16px 0">
           <tr><td style="padding:4px 0;color:#555">Student ID</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.studentId)}</td></tr>
           <tr><td style="padding:4px 0;color:#555">Temporary password</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.tempPassword)}</td></tr>
         </table>
         <p><a href="${escapeAttr(params.loginUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Sign in to Nucleus</a></p>
         <p style="color:#555">For your security you will be asked to set a new password the first time you sign in. Do not share these credentials with anyone.</p>
         <p style="color:#999;font-size:12px">If you did not expect this email, contact your institution immediately.</p>`,
      ),
    });
  }

  /**
   * Sent for self-service "forgot password". The link carries a single-use,
   * short-lived token; nothing actionable is exposed if the email is read by
   * someone else after the token has expired or been used.
   */
  /**
   * Sent when an admin provisions or resets an employee's login. Mirrors the
   * student variant — the employee is forced to replace the temporary password
   * on first login.
   */
  async sendEmployeeTempPassword(params: {
    to: string;
    displayName: string;
    empCode: string;
    tempPassword: string;
    loginUrl: string;
  }): Promise<void> {
    const subject = 'Your Nucleus employee login';
    const text = [
      `Hello ${params.displayName},`,
      '',
      'A login has been created for your Nucleus employee account.',
      '',
      `Employee code: ${params.empCode}`,
      `Temporary password: ${params.tempPassword}`,
      '',
      `Sign in here: ${params.loginUrl}`,
      '',
      'For your security you will be asked to set a new password the first',
      'time you sign in. Do not share these credentials with anyone.',
      '',
      'If you did not expect this email, contact your institution immediately.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject,
      text,
      html: wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>A login has been created for your Nucleus employee account.</p>
         <table cellpadding="0" cellspacing="0" style="margin:16px 0">
           <tr><td style="padding:4px 0;color:#555">Employee code</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.empCode)}</td></tr>
           <tr><td style="padding:4px 0;color:#555">Temporary password</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.tempPassword)}</td></tr>
         </table>
         <p><a href="${escapeAttr(params.loginUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Sign in to Nucleus</a></p>
         <p style="color:#555">For your security you will be asked to set a new password the first time you sign in. Do not share these credentials with anyone.</p>
         <p style="color:#999;font-size:12px">If you did not expect this email, contact your institution immediately.</p>`,
      ),
    });
  }

  /** Self-service password reset for employees. Mirrors the student variant. */
  async sendEmployeePasswordReset(params: {
    to: string;
    displayName: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const subject = 'Reset your Nucleus password';
    const text = [
      `Hello ${params.displayName},`,
      '',
      'We received a request to reset the password for your Nucleus employee',
      'account. Use the link below to choose a new password:',
      '',
      params.resetUrl,
      '',
      `This link expires in ${params.expiresInMinutes} minutes and can be used once.`,
      '',
      'If you did not request this, you can safely ignore this email — your',
      'password will not change.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject,
      text,
      html: wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>We received a request to reset the password for your Nucleus employee account.</p>
         <p><a href="${escapeAttr(params.resetUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Choose a new password</a></p>
         <p style="color:#555">This link expires in ${params.expiresInMinutes} minutes and can be used once.</p>
         <p style="color:#999;font-size:12px">If you did not request this, you can safely ignore this email — your password will not change.</p>`,
      ),
    });
  }

  /**
   * The email channel of the employee notification system — one generic
   * template for every module, driven entirely by the notification's own title
   * and body. Sending modules write the copy once and it renders identically
   * in-app, in the push tray and here.
   *
   * `url` is always the notification inbox rather than a per-target deep link:
   * the server has no knowledge of client routes (clients own that registry),
   * so the click-through lands on the one page that can resolve any
   * notification.
   */
  async sendEmployeeNotification(params: {
    to: string;
    displayName: string;
    title: string;
    body: string;
    url: string;
  }): Promise<void> {
    const text = [
      `Hello ${params.displayName},`,
      '',
      params.title,
      '',
      params.body,
      '',
      `Open Nucleus: ${params.url}`,
      '',
      'You are receiving this because notifications are on for this module.',
      'You can turn email off per module in Nucleus under Profile → Notifications.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject: params.title,
      text,
      html: wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p style="font-weight:600;font-size:15px;margin:16px 0 4px">${escapeHtml(params.title)}</p>
         <p style="margin:0 0 16px">${escapeHtml(params.body)}</p>
         <p><a href="${escapeAttr(params.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Open in Nucleus</a></p>
         <p style="color:#999;font-size:12px">You are receiving this because notifications are on for this module. You can turn email off per module under Profile → Notifications.</p>`,
      ),
    });
  }

  /**
   * Delivers a one-time code a guardian uses to set or reset their login
   * password (the self-service "forgot password" flow). The code is short-lived
   * and single-use; nothing actionable is exposed once it has expired or been
   * used. In dev this lands in `dev_mail_outbox` so the code is testable.
   */
  async sendGuardianOtp(params: {
    to: string;
    displayName: string;
    otp: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const subject = 'Your Nucleus parent login code';
    const text = [
      `Hello ${params.displayName},`,
      '',
      'Use this one-time code to set your Nucleus parent account password:',
      '',
      `Code: ${params.otp}`,
      '',
      `This code expires in ${params.expiresInMinutes} minutes and can be used once.`,
      '',
      'If you did not request this, you can safely ignore this email.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject,
      text,
      html: wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>Use this one-time code to set your Nucleus parent account password:</p>
         <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${escapeHtml(params.otp)}</p>
         <p style="color:#555">This code expires in ${params.expiresInMinutes} minutes and can be used once.</p>
         <p style="color:#999;font-size:12px">If you did not request this, you can safely ignore this email.</p>`,
      ),
    });
  }

  async sendStudentEmailOtp(params: {
    to: string;
    displayName: string;
    otp: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const subject = 'Verify your personal email for Nucleus';
    const text = [
      `Hello ${params.displayName},`,
      '',
      'Use this one-time code to verify this address as the personal email on',
      'your Nucleus student profile:',
      '',
      `Code: ${params.otp}`,
      '',
      `This code expires in ${params.expiresInMinutes} minutes and can be used once.`,
      '',
      'If you did not request this, you can safely ignore this email — your',
      'profile will not change.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject,
      text,
      html: wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>Use this one-time code to verify this address as the personal email on your Nucleus student profile:</p>
         <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:16px 0">${escapeHtml(params.otp)}</p>
         <p style="color:#555">This code expires in ${params.expiresInMinutes} minutes and can be used once.</p>
         <p style="color:#999;font-size:12px">If you did not request this, you can safely ignore this email — your profile will not change.</p>`,
      ),
    });
  }

  async sendStudentPasswordReset(params: {
    to: string;
    displayName: string;
    resetUrl: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const subject = 'Reset your Nucleus password';
    const text = [
      `Hello ${params.displayName},`,
      '',
      'We received a request to reset the password for your Nucleus student',
      'account. Use the link below to choose a new password:',
      '',
      params.resetUrl,
      '',
      `This link expires in ${params.expiresInMinutes} minutes and can be used once.`,
      '',
      'If you did not request this, you can safely ignore this email — your',
      'password will not change.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject,
      text,
      html: wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>We received a request to reset the password for your Nucleus student account.</p>
         <p><a href="${escapeAttr(params.resetUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Choose a new password</a></p>
         <p style="color:#555">This link expires in ${params.expiresInMinutes} minutes and can be used once.</p>
         <p style="color:#999;font-size:12px">If you did not request this, you can safely ignore this email — your password will not change.</p>`,
      ),
    });
  }
}

function wrapHtml(body: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 16px;font-size:18px">Nucleus</h2>
    ${body}
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
