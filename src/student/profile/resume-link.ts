import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

/**
 * The permanent public-resume link, in one place.
 *
 * Shared by {@link StudentResumeService} (which mints tokens one student at a
 * time on read) and the student query engine's `resume_link` hydrator (which
 * mints them in bulk for exports). Both must produce byte-identical URLs — a
 * resume link printed on a spreadsheet is the same link a student pastes into
 * a job application.
 */

/** Mint a share token. 24 random bytes → 32 base64url chars, fits varchar(64). */
export function mintResumeToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Public API origin the tokenized resume route is served from. */
export function resumeApiBase(config: ConfigService): string {
  const base =
    config.get<string>('API_PUBLIC_BASE_URL') ||
    `http://localhost:${config.get<string>('PORT', '3000')}`;
  return base.replace(/\/+$/, '');
}

export function buildResumeHostedUrl(base: string, token: string): string {
  return `${base}/public/resumes/${token}`;
}
