import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { Student } from '../../admin/entities/student.entity';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { storageKey } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';

export const RESUME_MAX_BYTES = 2 * 1024 * 1024; // < 2 MB, spec'd

/**
 * Both resume links, as PEERS — neither masks the other. Recruiters get both,
 * so one failing still leaves a working copy.
 */
export interface ResumeView {
  /** The permanent tokenized Nucleus route; null until a file is uploaded. */
  hosted_url: string | null;
  /** The raw external link (Drive, personal site); null when unset. */
  external_url: string | null;
  /** When the hosted PDF was last (re)uploaded. */
  uploaded_at: Date | null;
  /** Nucleus-link opens only — external traffic never reaches us. */
  download_count: number;
  last_downloaded_at: Date | null;
}

// Abuse guard on the unauthenticated download route. Generous for legitimate
// recruiter traffic, tight enough that scraping/hammering trips 429s.
const PUBLIC_RATE_LIMITS = {
  perIp: { max: 60, windowSeconds: 60 * 60 },
  perToken: { max: 120, windowSeconds: 60 * 60 },
} as const;

/**
 * Student resume — the NO_APPROVAL field: saved directly, no approver.
 *
 * TWO INDEPENDENT SOURCES, both live at once (neither wins):
 *  1. The hosted PDF: the object lives under the PRIVATE `resumes/` prefix and
 *     is shared as the PERMANENT tokenized route `GET /public/resumes/<token>`,
 *     which resolves the student's current resume_key at request time and 302s
 *     to a short-lived presigned URL. The token is minted once and never
 *     rotated — the link a student puts on job applications survives
 *     re-uploads and remove+re-upload cycles (a removed resume just 404s until
 *     a file exists again).
 *  2. `resume_external_url`: a raw external link (Drive, personal site) handed
 *     out as-is — deliberately NOT proxied through us, so it keeps working
 *     when our API or storage doesn't.
 *
 * Students are nudged (not forced) to maintain both, so a recruiter always has
 * a fallback. Only hosted-link opens are countable — that's the price of the
 * external link's independence.
 *
 * Shared by the student self-service routes and the admin routes.
 */
@Injectable()
export class StudentResumeService {
  private readonly logger = new Logger(StudentResumeService.name);

  constructor(
    @InjectRepository(Student)
    private readonly students: Repository<Student>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  private hostedUrlFor(token: string): string {
    const base =
      this.config.get<string>('API_PUBLIC_BASE_URL') ||
      `http://localhost:${this.config.get<string>('PORT', '3000')}`;
    return `${base.replace(/\/+$/, '')}/public/resumes/${token}`;
  }

  /**
   * Mint the permanent share token if the student never had one. Separate
   * from setResume so resumes uploaded before tokens existed heal on their
   * next read.
   */
  private async ensureToken(student: Student): Promise<string> {
    if (student.resume_public_token) return student.resume_public_token;
    const token = randomBytes(24).toString('base64url');
    student.resume_public_token = token;
    await this.students.update(
      { id: student.id },
      { resume_public_token: token },
    );
    return token;
  }

  /**
   * Both links for profile/admin views. Always returns a view (fields nullable
   * when a source is unset) — clients render the two sources side by side and
   * need to know precisely which one is MISSING to nudge for a backup.
   */
  async viewFor(student: Student): Promise<ResumeView> {
    return {
      hosted_url: student.resume_key
        ? this.hostedUrlFor(await this.ensureToken(student))
        : null,
      external_url: student.resume_external_url,
      uploaded_at: student.resume_uploaded_at,
      download_count: student.resume_download_count,
      last_downloaded_at: student.resume_last_downloaded_at,
    };
  }

  async setResume(
    studentId: number,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<ResumeView> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    if (file.size > RESUME_MAX_BYTES) {
      throw new BadRequestException('Resume must be smaller than 2 MB.');
    }
    // Belt and braces: mime says PDF AND the bytes start with the PDF magic —
    // the object is reachable through the public route, so never store
    // mislabeled content.
    if (
      file.mimetype !== 'application/pdf' ||
      !file.buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')
    ) {
      throw new BadRequestException('Resume must be a PDF file.');
    }

    const previousKey = student.resume_key;
    const key = storageKey.studentResume();
    await this.storage.putObject(key, file.buffer, 'application/pdf');

    student.resume_key = key;
    student.resume_uploaded_at = new Date();
    await this.students.save(student);
    await this.ensureToken(student);

    if (previousKey && previousKey !== key) {
      await this.storage.deleteObject(previousKey);
    }

    return this.viewFor(student);
  }

  async removeResume(studentId: number): Promise<void> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const key = student.resume_key;
    if (!key) return;

    // The token deliberately survives: the shared link must come back alive
    // on the next upload instead of breaking forever.
    student.resume_key = null;
    student.resume_uploaded_at = null;
    await this.students.save(student);
    await this.storage.deleteObject(key);
  }

  /** Set (or clear with null) the external resume link. */
  async setExternalUrl(
    studentId: number,
    url: string | null,
  ): Promise<ResumeView> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    student.resume_external_url = url;
    await this.students.save(student);
    return this.viewFor(student);
  }

  /**
   * Resolve a public-route hit: token → presigned URL of the CURRENT file.
   * 404 on unknown token, inactive student, or no file; 429 past the limits.
   * The presigned URL is Redis-memoized (getCachedReadUrl), so repeated
   * legitimate hits don't re-sign.
   *
   * Counts the hit — see countDownload for what the number does and doesn't
   * mean. Only reached after the rate-limit gates and the 404 checks, so
   * throttled requests and misses never inflate it.
   */
  async resolvePublicDownload(token: string, ip?: string): Promise<string> {
    await this.enforceRateLimit('resume:ip', ip, PUBLIC_RATE_LIMITS.perIp);
    await this.enforceRateLimit(
      'resume:token',
      token,
      PUBLIC_RATE_LIMITS.perToken,
    );

    const student = await this.students.findOne({
      where: { resume_public_token: token },
    });
    if (!student || !student.is_active || !student.resume_key) {
      throw new NotFoundException('Resume not found');
    }

    const url = await this.storage.getCachedReadUrl(student.resume_key);
    await this.countDownload(student.id);
    return url;
  }

  /**
   * +1 on this student's resume counter. Atomic (never read-modify-write, so
   * concurrent recruiters can't lose counts) and best-effort — a failed
   * counter write must never break a recruiter's download.
   *
   * Honest semantics: this counts LINK OPENS, not bytes served (the route
   * redirects to a cached presigned URL, and that URL can be re-fetched
   * without touching us), link-preview bots (Slack/WhatsApp/Gmail) inflate it,
   * the 120/hr per-token limit caps how fast it can grow, and external-link
   * traffic is invisible by design.
   */
  private async countDownload(studentId: number): Promise<void> {
    try {
      await this.students.query(
        `UPDATE "students"
         SET "resume_download_count" = "resume_download_count" + 1,
             "resume_last_downloaded_at" = now()
         WHERE "id" = $1`,
        [studentId],
      );
    } catch (err) {
      this.logger.warn(
        `Failed to count resume download for student ${studentId}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  private async enforceRateLimit(
    bucket: string,
    subject: string | undefined,
    limit: { max: number; windowSeconds: number },
  ): Promise<void> {
    if (!subject) return;
    const key = `public:rl:${bucket}:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, limit.windowSeconds);
    if (count > limit.max) {
      throw new HttpException(
        'Too many requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
