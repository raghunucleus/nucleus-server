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
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>A login has been created for your Nucleus student account.</p>
         <table cellpadding="0" cellspacing="0" style="margin:16px 0">
           <tr><td style="padding:4px 0;color:#6c757d">Student ID</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.studentId)}</td></tr>
           <tr><td style="padding:4px 0;color:#6c757d">Temporary password</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.tempPassword)}</td></tr>
         </table>
         <p><a href="${escapeAttr(params.loginUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">Sign in to Nucleus</a></p>
         <p style="color:#6c757d">For your security you will be asked to set a new password the first time you sign in. Do not share these credentials with anyone.</p>
         <p style="color:#6c757d;font-size:12px">If you did not expect this email, contact your institution immediately.</p>`,
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
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>A login has been created for your Nucleus employee account.</p>
         <table cellpadding="0" cellspacing="0" style="margin:16px 0">
           <tr><td style="padding:4px 0;color:#6c757d">Employee code</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.empCode)}</td></tr>
           <tr><td style="padding:4px 0;color:#6c757d">Temporary password</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.tempPassword)}</td></tr>
         </table>
         <p><a href="${escapeAttr(params.loginUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">Sign in to Nucleus</a></p>
         <p style="color:#6c757d">For your security you will be asked to set a new password the first time you sign in. Do not share these credentials with anyone.</p>
         <p style="color:#6c757d;font-size:12px">If you did not expect this email, contact your institution immediately.</p>`,
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
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>We received a request to reset the password for your Nucleus employee account.</p>
         <p><a href="${escapeAttr(params.resetUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">Choose a new password</a></p>
         <p style="color:#6c757d">This link expires in ${params.expiresInMinutes} minutes and can be used once.</p>
         <p style="color:#6c757d;font-size:12px">If you did not request this, you can safely ignore this email — your password will not change.</p>`,
      ),
    });
  }

  /**
   * Account invitation for an employee: a single-use link that lets them
   * choose their own first password.
   *
   * Deliberately a different subject line from the reset email — someone who
   * receives both (invited, then reset before they got round to it) has to be
   * able to tell which link is which.
   */
  async sendEmployeeInvite(params: {
    to: string;
    displayName: string;
    empCode: string;
    inviteUrl: string;
    expiresInDays: number;
  }): Promise<void> {
    const subject = 'Set up your Nucleus account';
    const text = [
      `Hello ${params.displayName},`,
      '',
      "An account has been created for you on Nucleus, your institution's",
      'employee portal. Use the link below to choose your password and sign in',
      'for the first time:',
      '',
      params.inviteUrl,
      '',
      `Employee code: ${params.empCode}`,
      '',
      `This link expires in ${params.expiresInDays} days and can be used once.`,
      '',
      'If you were not expecting this email, you can safely ignore it.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject,
      text,
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>An account has been created for you on Nucleus, your institution's employee portal. Choose a password below to finish setting it up.</p>
         <table cellpadding="0" cellspacing="0" style="margin:16px 0">
           <tr><td style="padding:4px 0;color:#6c757d">Employee code</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.empCode)}</td></tr>
         </table>
         <p><a href="${escapeAttr(params.inviteUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">Set your password</a></p>
         <p style="color:#6c757d">This link expires in ${params.expiresInDays} days and can be used once.</p>
         <p style="color:#6c757d;font-size:12px">If you were not expecting this email, you can safely ignore it.</p>`,
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
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p style="font-weight:600;font-size:15px;margin:16px 0 4px">${escapeHtml(params.title)}</p>
         <p style="margin:0 0 16px">${escapeHtml(params.body)}</p>
         <p><a href="${escapeAttr(params.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">Open in Nucleus</a></p>
         <p style="color:#6c757d;font-size:12px">You are receiving this because notifications are on for this module. You can turn email off per module under Profile → Notifications.</p>`,
      ),
    });
  }

  /**
   * The student mirror of {@link sendEmployeeNotification}. Same generic
   * title/body template, but no "turn this off under Profile → Notifications"
   * footer: students have no per-module notification preferences, and email is
   * opt-in per send by the module rather than by the recipient.
   *
   * `body` may be multi-line (a composed message plus a list); newlines are
   * preserved in the HTML with `white-space:pre-line` rather than by splitting
   * into paragraphs, so the plain-text and HTML parts read identically.
   *
   * `details` renders a label/value table under the body for notifications that
   * carry structured facts (a drive's company, date and deadline). Everything is
   * styled inline on a `<table>` on purpose: mail clients strip `<style>` blocks
   * and external stylesheets, so a CSS framework would arrive as unstyled text.
   */
  async sendStudentNotification(params: {
    to: string;
    displayName: string;
    title: string;
    body: string;
    url: string;
    subject?: string;
    details?: { label: string; value: string }[];
    ctaLabel?: string;
  }): Promise<void> {
    const details = params.details ?? [];
    const cta = params.ctaLabel ?? 'Open in Nucleus';
    const text = [
      `Hello ${params.displayName},`,
      '',
      params.title,
      '',
      params.body,
      ...(details.length > 0
        ? ['', ...details.map((d) => `${d.label}: ${d.value}`)]
        : []),
      '',
      `${cta}: ${params.url}`,
    ].join('\n');

    const detailsHtml =
      details.length === 0
        ? ''
        : `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate;margin:0 0 16px">
           ${details
             .map(
               (d, i) =>
                 `<tr>
                    <td style="padding:8px 12px;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top${i > 0 ? ';border-top:1px solid #e5e7eb' : ''}">${escapeHtml(d.label)}</td>
                    <td style="padding:8px 12px;font-size:13px;font-weight:600;vertical-align:top${i > 0 ? ';border-top:1px solid #e5e7eb' : ''}">${escapeHtml(d.value)}</td>
                  </tr>`,
             )
             .join('')}
         </table>`;

    await this.send({
      to: params.to,
      subject: params.subject ?? params.title,
      text,
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p style="font-weight:600;font-size:15px;margin:16px 0 4px">${escapeHtml(params.title)}</p>
         <p style="margin:0 0 16px;white-space:pre-line">${escapeHtml(params.body)}</p>
         ${detailsHtml}
         <p><a href="${escapeAttr(params.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">${escapeHtml(cta)}</a></p>`,
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
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>Use this one-time code to set your Nucleus parent account password:</p>
         <p style="background-color:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;padding:14px;margin:16px 0;text-align:center;font-family:Consolas,Menlo,Monaco,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:#212529">${escapeHtml(params.otp)}</p>
         <p style="color:#6c757d">This code expires in ${params.expiresInMinutes} minutes and can be used once.</p>
         <p style="color:#6c757d;font-size:12px">If you did not request this, you can safely ignore this email.</p>`,
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
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>Use this one-time code to verify this address as the personal email on your Nucleus student profile:</p>
         <p style="background-color:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;padding:14px;margin:16px 0;text-align:center;font-family:Consolas,Menlo,Monaco,monospace;font-size:28px;font-weight:700;letter-spacing:6px;color:#212529">${escapeHtml(params.otp)}</p>
         <p style="color:#6c757d">This code expires in ${params.expiresInMinutes} minutes and can be used once.</p>
         <p style="color:#6c757d;font-size:12px">If you did not request this, you can safely ignore this email — your profile will not change.</p>`,
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
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>We received a request to reset the password for your Nucleus student account.</p>
         <p><a href="${escapeAttr(params.resetUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">Choose a new password</a></p>
         <p style="color:#6c757d">This link expires in ${params.expiresInMinutes} minutes and can be used once.</p>
         <p style="color:#6c757d;font-size:12px">If you did not request this, you can safely ignore this email — your password will not change.</p>`,
      ),
    });
  }

  /** Account invitation for a student. Mirrors the employee variant. */
  async sendStudentInvite(params: {
    to: string;
    displayName: string;
    studentId: string;
    inviteUrl: string;
    expiresInDays: number;
  }): Promise<void> {
    const subject = 'Set up your Nucleus account';
    const text = [
      `Hello ${params.displayName},`,
      '',
      "An account has been created for you on Nucleus, your institution's",
      'student portal. Use the link below to choose your password and sign in',
      'for the first time:',
      '',
      params.inviteUrl,
      '',
      `Student ID: ${params.studentId}`,
      '',
      `This link expires in ${params.expiresInDays} days and can be used once.`,
      '',
      'If you were not expecting this email, you can safely ignore it.',
    ].join('\n');

    await this.send({
      to: params.to,
      subject,
      text,
      html: this.wrapHtml(
        `<p>Hello ${escapeHtml(params.displayName)},</p>
         <p>An account has been created for you on Nucleus, your institution's student portal. Choose a password below to finish setting it up.</p>
         <table cellpadding="0" cellspacing="0" style="margin:16px 0">
           <tr><td style="padding:4px 0;color:#6c757d">Student ID</td>
               <td style="padding:4px 0 4px 16px;font-weight:600">${escapeHtml(params.studentId)}</td></tr>
         </table>
         <p><a href="${escapeAttr(params.inviteUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">Set your password</a></p>
         <p style="color:#6c757d">This link expires in ${params.expiresInDays} days and can be used once.</p>
         <p style="color:#6c757d;font-size:12px">If you were not expecting this email, you can safely ignore it.</p>`,
      ),
    });
  }

  /** Every template renders into the shared shell. */
  private wrapHtml(body: string): string {
    return renderMailShell(body);
  }
}

/**
 * Bootstrap 5's design tokens, with its `$primary` (#0d6efd) swapped for the
 * Nucleus brand blue so mail matches the app. Kept as constants because they
 * have to be repeated inline on every element — email has no stylesheet.
 */
const MAIL_THEME = {
  /** `$gray-100` — the page behind the card. */
  page: '#f8f9fa',
  card: '#ffffff',
  /** `$gray-300` — Bootstrap's card border. */
  border: '#dee2e6',
  /** `$gray-900` / `$gray-600` — body copy and `.text-muted`. */
  text: '#212529',
  muted: '#6c757d',
  /** Brand blue, from nucleus-ui's `--brand-primary`. */
  primary: '#2563eb',
  // Single-quoted family names: these are interpolated into double-quoted
  // `style="..."` attributes, and double quotes would close the attribute.
  font: "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
} as const;

/**
 * The shared shell every template renders into: a Bootstrap-style card with a
 * brand header bar and a muted footer.
 *
 * Built as nested tables with fully inlined styles rather than a Bootstrap CDN
 * link, because no mail client would honour one — Gmail strips external
 * stylesheets outright, and Outlook desktop renders through Word, which has no
 * flexbox or grid for Bootstrap's layout classes to use. Tables also stand in
 * for `max-width` + `margin:0 auto`, which Word ignores.
 *
 * Every colour is stated explicitly (no `<style>` block, no media queries, no
 * `prefers-color-scheme`) so a client's dark mode cannot invert the card into
 * white-on-white. `role="presentation"` keeps screen readers from announcing
 * the layout tables as data.
 *
 * `body` is dropped in verbatim, so each template keeps authoring plain `<p>`
 * markup and gets the new frame for free.
 *
 * The header is a plain-text "Nucleus" wordmark, deliberately not an image: a
 * remote logo shows as a broken-image icon whenever the client blocks remote
 * images or can't reach the host, while text renders identically everywhere.
 */
function renderMailShell(body: string): string {
  const brand = `<span style="font-family:${MAIL_THEME.font};font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em">Nucleus</span>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${MAIL_THEME.page};margin:0;padding:24px 12px">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
        <tr>
          <td style="background-color:${MAIL_THEME.primary};border-radius:8px 8px 0 0;padding:20px 24px">
            ${brand}
          </td>
        </tr>
        <tr>
          <td style="background-color:${MAIL_THEME.card};border:1px solid ${MAIL_THEME.border};border-top:0;border-radius:0 0 8px 8px;padding:24px;font-family:${MAIL_THEME.font};font-size:14px;line-height:1.6;color:${MAIL_THEME.text}">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;text-align:center;font-family:${MAIL_THEME.font};font-size:12px;line-height:1.5;color:${MAIL_THEME.muted}">
            This is an automated message from Nucleus. Please do not reply to this email.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
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
