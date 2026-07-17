import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { Student } from '../admin/entities/student.entity';
import { displayedAdmissionYear } from '../common/admission-year';
import { MailService } from '../mail/mail.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { StorageService } from '../storage/storage.service';
import { StudentGoogleOidcService } from './auth/student-google-oidc.service';
import { StudentCredential } from './entities/student-credential.entity';

/** Claims carried by a student access token. */
export interface StudentAccessPayload {
  sub: number; // students.id
  student_id: string; // roll number
  mcp: boolean; // must change password
}

/** Claims carried by a student refresh token. */
interface StudentRefreshPayload {
  sub: number;
  fid: string; // token family id
  jti: string; // this token's unique id within the family
}

export interface StudentAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface StudentSummary {
  id: number;
  student_id: string;
  display_name: string;
  email: string;
}

export interface StudentLoginResult extends StudentAuthTokens {
  mustChangePassword: boolean;
  student: StudentSummary;
}

/** The student's own profile, returned by GET /student/auth/me. */
export interface StudentProfile extends StudentSummary {
  gender: string;
  dob: string;
  blood_group: string | null;
  mobile_number: string;
  is_active: boolean;
  programme: { id: number; name: string; code: string } | null;
  admission_year: { id: number; year: number; display_year: string } | null;
  /** Presigned, short-lived URL of the profile photo; null when unset. */
  photo_url: string | null;
}

const BCRYPT_ROUNDS = 12;

// Per-account brute-force protection. NAT-proof: it keys on the account, not
// the IP, so a whole campus behind one address can still sign in normally.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Per-IP / per-identifier request caps. The login cap is intentionally loose
// — campus Wi-Fi shares one public IP, so this is only a DoS backstop; the
// real brute-force defence is the per-account lockout above.
const RATE_LIMITS = {
  login: { max: 200, windowSeconds: 15 * 60 },
  forgotByIp: { max: 40, windowSeconds: 60 * 60 },
  forgotByIdentifier: { max: 5, windowSeconds: 60 * 60 },
  reset: { max: 30, windowSeconds: 60 * 60 },
} as const;

@Injectable()
export class StudentAuthService {
  private readonly logger = new Logger(StudentAuthService.name);
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @InjectRepository(Student) private readonly students: Repository<Student>,
    @InjectRepository(StudentCredential)
    private readonly credentials: Repository<StudentCredential>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly googleOidc: StudentGoogleOidcService,
    private readonly storage: StorageService,
  ) {}

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(
    studentId: string,
    password: string,
    ip?: string,
  ): Promise<StudentLoginResult> {
    await this.enforceRateLimit('login', ip, RATE_LIMITS.login);

    // Generic message for every credential failure so the endpoint never
    // reveals whether a given student ID exists.
    const genericFailure = new UnauthorizedException(
      'Invalid student ID or password',
    );

    const student = await this.students
      .createQueryBuilder('s')
      .where('LOWER(s.student_id) = LOWER(:sid)', { sid: studentId })
      .getOne();

    if (!student) {
      // Equalise response time with the password-check path.
      await this.verifyAgainstDummy(password);
      throw genericFailure;
    }

    const cred = await this.getOrCreateCredential(student.id);

    if (cred.locked_until && cred.locked_until.getTime() > Date.now()) {
      throw new UnauthorizedException(
        'Account temporarily locked after repeated failed sign-in attempts. Try again later.',
      );
    }

    if (!cred.password_hash) {
      // Provisioned student record but no password set yet.
      await this.verifyAgainstDummy(password);
      throw genericFailure;
    }

    const passwordOk = await bcrypt.compare(password, cred.password_hash);
    if (!passwordOk) {
      await this.registerFailedAttempt(cred);
      throw genericFailure;
    }

    // Only reveal the inactive state once credentials are proven correct, so
    // it can't be used to probe which IDs are valid.
    if (!student.is_active) {
      throw new UnauthorizedException(
        'Your student account is inactive. Please contact your institution.',
      );
    }

    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    cred.last_login_at = new Date();
    cred.last_login_ip = ip ?? null;
    await this.credentials.save(cred);

    const tokens = await this.issueTokens(
      student,
      cred.must_change_password,
      randomUUID(),
    );
    return {
      ...tokens,
      mustChangePassword: cred.must_change_password,
      student: this.toSummary(student),
    };
  }

  // ---------------------------------------------------------------------------
  // Google sign-in
  // ---------------------------------------------------------------------------

  /**
   * Sign in with a Google ID token. Identity is established by Google; the
   * student record must already exist (matched by email) — students are never
   * auto-provisioned here. The Google subject is linked on first sign-in and
   * required to match afterwards. A Google session never carries the
   * must-change-password flag: it isn't a password login.
   */
  async loginWithGoogle(
    idToken: string,
    ip?: string,
  ): Promise<StudentLoginResult> {
    await this.enforceRateLimit('login', ip, RATE_LIMITS.login);

    const identity = await this.googleOidc.verifyIdToken(idToken);
    if (!identity.emailVerified) {
      throw new UnauthorizedException(
        'Your Google account email is not verified.',
      );
    }

    const student = await this.students
      .createQueryBuilder('s')
      .where('LOWER(s.email) = LOWER(:email)', { email: identity.email })
      .getOne();

    // Generic message — never reveal whether the email maps to a student.
    if (!student) {
      throw new UnauthorizedException(
        'This Google account is not linked to a student.',
      );
    }
    if (!student.is_active) {
      throw new UnauthorizedException(
        'Your student account is inactive. Please contact your institution.',
      );
    }

    const cred = await this.getOrCreateCredential(student.id);

    // Link the Google subject on first sign-in; require it to match on every
    // later sign-in so a Google-side email reassignment can't take over.
    if (cred.google_id && cred.google_id !== identity.sub) {
      throw new UnauthorizedException(
        'This Google account is not linked to a student.',
      );
    }

    cred.google_id = identity.sub;
    cred.last_login_at = new Date();
    cred.last_login_ip = ip ?? null;
    await this.credentials.save(cred);

    const tokens = await this.issueTokens(student, false, randomUUID());
    return {
      ...tokens,
      mustChangePassword: false,
      student: this.toSummary(student),
    };
  }

  // ---------------------------------------------------------------------------
  // Refresh — single-use rotation with token-reuse detection
  // ---------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<StudentAuthTokens> {
    let payload: StudentRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<StudentRefreshPayload>(
        refreshToken,
        {
          secret: this.config.getOrThrow<string>('JWT_STUDENT_REFRESH_SECRET'),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const familyKey = this.familyKey(payload.sub, payload.fid);
    const currentJti = await this.redis.get(familyKey);

    if (!currentJti) {
      // Family was revoked (logout / password change) or simply expired.
      throw new UnauthorizedException(
        'Your session has expired. Please sign in again.',
      );
    }

    if (currentJti !== payload.jti) {
      // A non-current token from a live family was replayed. The only way to
      // hold such a token is to have captured one before it was rotated —
      // treat it as theft and burn the whole family.
      await this.redis.del(familyKey);
      this.logger.warn(
        `Refresh-token reuse detected for student ${payload.sub}; family ${payload.fid} revoked`,
      );
      throw new UnauthorizedException(
        'Session security check failed. Please sign in again.',
      );
    }

    const student = await this.students.findOne({
      where: { id: payload.sub },
    });
    if (!student || !student.is_active) {
      await this.redis.del(familyKey);
      throw new UnauthorizedException('Account is no longer active');
    }

    const cred = await this.getOrCreateCredential(student.id);
    // Rotate within the same family (issueTokens overwrites the family key).
    return this.issueTokens(student, cred.must_change_password, payload.fid);
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  /** Revoke every refresh-token family for a student (all devices). */
  async logout(studentId: number): Promise<void> {
    const stream = this.redis.scanStream({
      match: this.familyKey(studentId, '*'),
      count: 100,
    });
    for await (const keys of stream) {
      if ((keys as string[]).length) {
        await this.redis.del(...(keys as string[]));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Password change (forced first-login change and voluntary change)
  // ---------------------------------------------------------------------------

  async changePassword(
    studentId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<StudentAuthTokens> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new UnauthorizedException();

    const cred = await this.getOrCreateCredential(studentId);
    if (!cred.password_hash) throw new UnauthorizedException();

    const ok = await bcrypt.compare(currentPassword, cred.password_hash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    if (currentPassword === newPassword) {
      throw new ConflictException(
        'New password must be different from the current password',
      );
    }

    cred.password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    cred.must_change_password = false;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    // Revoke every existing session, then mint a fresh pair for the caller so
    // the current device stays signed in without the must-change flag.
    await this.logout(studentId);
    return this.issueTokens(student, false, randomUUID());
  }

  // ---------------------------------------------------------------------------
  // Forgot / reset password (self-service, email-driven)
  // ---------------------------------------------------------------------------

  /**
   * Always resolves without indicating whether the identifier matched anyone —
   * the controller returns an identical response either way so the endpoint
   * cannot be used to enumerate students.
   */
  async forgotPassword(identifier: string, ip?: string): Promise<void> {
    await this.enforceRateLimit('forgot-ip', ip, RATE_LIMITS.forgotByIp);
    await this.enforceRateLimit(
      'forgot-id',
      identifier.toLowerCase(),
      RATE_LIMITS.forgotByIdentifier,
    );

    const student = await this.findStudentByIdentifier(identifier);
    if (!student || !student.is_active) return;

    await this.getOrCreateCredential(student.id);

    const ttlSeconds = this.resetTokenTtlSeconds();
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.resetKey(this.hashToken(token)),
      String(student.id),
      'EX',
      ttlSeconds,
    );

    const resetUrl = `${this.studentAppUrl()}/?reset-token=${token}`;
    try {
      await this.mail.sendStudentPasswordReset({
        to: student.email,
        displayName: student.display_name,
        resetUrl,
        expiresInMinutes: Math.round(ttlSeconds / 60),
      });
    } catch (err) {
      // Swallow: a delivery failure must not change the response shape.
      this.logger.error(
        `Failed to send password-reset email for student ${student.id}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  async resetPassword(
    token: string,
    newPassword: string,
    ip?: string,
  ): Promise<void> {
    await this.enforceRateLimit('reset', ip, RATE_LIMITS.reset);

    const key = this.resetKey(this.hashToken(token));
    const studentIdRaw = await this.redis.get(key);
    if (!studentIdRaw) {
      throw new HttpException(
        'This password reset link is invalid or has expired.',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Single-use: consume the token before doing anything else.
    await this.redis.del(key);

    const studentId = Number(studentIdRaw);
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student || !student.is_active) {
      throw new HttpException(
        'This password reset link is invalid or has expired.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const cred = await this.getOrCreateCredential(studentId);
    cred.password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    cred.must_change_password = false;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    // A reset implies the account may be compromised — drop every session.
    await this.logout(studentId);
  }

  // ---------------------------------------------------------------------------
  // Admin-initiated reset / provisioning
  // ---------------------------------------------------------------------------

  /**
   * Called from the admin module. Generates a random temporary password,
   * emails it to the student's registered address, and forces a change on
   * first login. The password is only persisted once the email has been
   * accepted, so a delivery failure never strands the student.
   */
  async adminResetPassword(studentId: number): Promise<{ email: string }> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const cred = await this.getOrCreateCredential(studentId);

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    // Send first — if delivery throws, nothing is persisted and the student
    // keeps whatever password they had.
    await this.mail.sendStudentTempPassword({
      to: student.email,
      displayName: student.display_name,
      studentId: student.student_id,
      tempPassword,
      loginUrl: `${this.studentAppUrl()}/`,
    });

    cred.password_hash = hash;
    cred.must_change_password = true;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    // Invalidate any sessions the student (or someone misusing the account)
    // currently holds.
    await this.logout(studentId);

    return { email: student.email };
  }

  /**
   * Admin sets a student's password directly to a chosen value. No email is
   * sent — the admin shares it with the student out-of-band. Like a reset it
   * forces a change on first login (the admin knows this password) and revokes
   * any active sessions.
   */
  async adminSetPassword(studentId: number, password: string): Promise<void> {
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const cred = await this.getOrCreateCredential(studentId);
    cred.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    cred.must_change_password = true;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    await this.logout(studentId);
  }

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  async getProfile(studentId: number): Promise<StudentProfile> {
    // The Student entity eager-loads programme and admission_year.
    const student = await this.students.findOne({ where: { id: studentId } });
    if (!student) throw new UnauthorizedException();
    return {
      // Stable ~12h cached URL (same URL across refetches → client image
      // caches hit). No HEAD probe: clients fall back to an initials avatar
      // if the object is gone or the URL expired.
      photo_url: student.photo_key
        ? await this.storage.getCachedReadUrl(student.photo_key)
        : null,
      id: student.id,
      student_id: student.student_id,
      display_name: student.display_name,
      email: student.email,
      gender: student.gender,
      dob: student.dob,
      blood_group: student.blood_group,
      mobile_number: student.mobile_number,
      is_active: student.is_active,
      programme: student.programme
        ? {
            id: student.programme.id,
            name: student.programme.name,
            code: student.programme.code,
          }
        : null,
      admission_year: student.admission_year
        ? {
            id: student.admission_year.id,
            year: student.admission_year.year,
            // Lateral entrants see their joining year (+1); view-only, the
            // stored batch (`id`/`year`) is unchanged.
            display_year: displayedAdmissionYear(
              student.admission_year.display_year,
              student.entry_type,
            ),
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async issueTokens(
    student: Student,
    mustChangePassword: boolean,
    familyId: string,
  ): Promise<StudentAuthTokens> {
    const accessPayload: StudentAccessPayload = {
      sub: student.id,
      student_id: student.student_id,
      mcp: mustChangePassword,
    };

    const accessTtl = parseDurationToSeconds(
      this.config.get<string>('JWT_STUDENT_ACCESS_TTL', '15m'),
    );
    const refreshTtl = parseDurationToSeconds(
      this.config.get<string>('JWT_STUDENT_REFRESH_TTL', '7d'),
    );

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_STUDENT_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });

    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: student.id, fid: familyId, jti } satisfies StudentRefreshPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_STUDENT_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      },
    );

    // The family key holds the *current* valid jti. Rotation overwrites it;
    // any stale jti presented later fails the equality check in refresh().
    await this.redis.set(
      this.familyKey(student.id, familyId),
      jti,
      'EX',
      refreshTtl,
    );

    return { accessToken, refreshToken };
  }

  private async registerFailedAttempt(cred: StudentCredential): Promise<void> {
    cred.failed_login_attempts += 1;
    if (cred.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
      cred.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
      cred.failed_login_attempts = 0;
    }
    await this.credentials.save(cred);
  }

  private async getOrCreateCredential(
    studentId: number,
  ): Promise<StudentCredential> {
    const existing = await this.credentials.findOne({
      where: { student_id: studentId },
    });
    if (existing) return existing;

    try {
      return await this.credentials.save(
        this.credentials.create({
          student_id: studentId,
          password_hash: null,
          must_change_password: true,
          failed_login_attempts: 0,
        }),
      );
    } catch {
      // Lost a race with a concurrent create — use the row that won.
      const row = await this.credentials.findOne({
        where: { student_id: studentId },
      });
      if (row) return row;
      throw new HttpException(
        'Could not initialise student credentials',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async findStudentByIdentifier(
    identifier: string,
  ): Promise<Student | null> {
    return this.students
      .createQueryBuilder('s')
      .where(
        'LOWER(s.student_id) = LOWER(:id) OR LOWER(s.email) = LOWER(:id)',
        { id: identifier },
      )
      .getOne();
  }

  private async enforceRateLimit(
    bucket: string,
    subject: string | undefined,
    limit: { max: number; windowSeconds: number },
  ): Promise<void> {
    if (!subject) return; // No subject to key on — skip rather than hard-fail.
    const key = `student:rl:${bucket}:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, limit.windowSeconds);
    }
    if (count > limit.max) {
      throw new HttpException(
        'Too many requests. Please wait a while and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Burns a fixed bcrypt cost so absent/passwordless accounts time like real ones. */
  private async verifyAgainstDummy(password: string): Promise<void> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = bcrypt.hash(
        randomBytes(24).toString('hex'),
        BCRYPT_ROUNDS,
      );
    }
    await bcrypt.compare(password, await this.dummyHashPromise);
  }

  private toSummary(student: Student): StudentSummary {
    return {
      id: student.id,
      student_id: student.student_id,
      display_name: student.display_name,
      email: student.email,
    };
  }

  private familyKey(studentId: number, familyId: string): string {
    return `student:rt:${studentId}:${familyId}`;
  }

  private resetKey(tokenHash: string): string {
    return `student:pwreset:${tokenHash}`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private studentAppUrl(): string {
    return this.config
      .get<string>('STUDENT_APP_URL', 'http://localhost:5000')
      .replace(/\/+$/, '');
  }

  private resetTokenTtlSeconds(): number {
    return parseDurationToSeconds(
      this.config.get<string>('STUDENT_PASSWORD_RESET_TTL', '30m'),
    );
  }
}

/** Random 16-char temp password, guaranteed to contain a mix of char classes. */
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;

  const bytes = randomBytes(16);
  const chars: string[] = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
  ];
  for (let i = 3; i < bytes.length; i++) {
    chars.push(all[bytes[i] % all.length]);
  }

  // Shuffle so the guaranteed leading chars aren't predictable.
  const shuffle = randomBytes(chars.length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(input.trim());
  if (!match) return 7 * 24 * 60 * 60;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * mult[unit];
}
