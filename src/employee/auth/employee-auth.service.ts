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
import { createHash, randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import {
  AuthSessionsService,
  SessionContext,
} from '../../auth-sessions/auth-sessions.service';
import {
  DeviceLimitChallenge,
  DeviceLimitChallengeService,
} from '../../auth-sessions/device-limit-challenge.service';
import { throwDeviceLimit } from '../../auth-sessions/device-limit';
import { DEFAULT_DEVICE_LIMIT } from '../../auth-sessions/session.constants';
import type { DeviceLimitLoginInput } from '../../auth-sessions/dto/device-limit-login.dto';
import { MailService } from '../../mail/mail.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { EmployeeGoogleOidcService } from './employee-google-oidc.service';
import { EmployeeCredential } from './entities/employee-credential.entity';

/** Claims carried by an employee access token. */
export interface EmployeeAccessPayload {
  sub: number; // employees.id
  emp_code: string;
  mcp: boolean; // must change password
  sid: string; // auth_sessions.id — checked against the revocation denylist
}

/** Claims carried by an employee refresh token. */
interface EmployeeRefreshPayload {
  sub: number;
  sid: string; // auth_sessions.id
  jti: string; // must equal the session's current refresh_jti
}

export interface EmployeeAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface EmployeeSummary {
  id: number;
  emp_code: string;
  emp_display_name: string;
  email: string;
}

export interface EmployeeLoginResult extends EmployeeAuthTokens {
  mustChangePassword: boolean;
  employee: EmployeeSummary;
}

/** The employee's own profile, returned by GET /employee/auth/me. */
export interface EmployeeProfile extends EmployeeSummary {
  gender: string;
  mobile_number: string;
  country_code: string;
  is_active: boolean;
  department: { id: number; name: string; code: string } | null;
  designation: { id: number; name: string; code: string } | null;
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
export class EmployeeAuthService {
  private readonly logger = new Logger(EmployeeAuthService.name);
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(EmployeeCredential)
    private readonly credentials: Repository<EmployeeCredential>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly googleOidc: EmployeeGoogleOidcService,
    private readonly sessions: AuthSessionsService,
    private readonly challenges: DeviceLimitChallengeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(
    empCode: string,
    password: string,
    ctx: SessionContext = {},
  ): Promise<EmployeeLoginResult> {
    await this.enforceRateLimit(
      'login',
      ctx.ip ?? undefined,
      RATE_LIMITS.login,
    );

    // Generic message for every credential failure so the endpoint never
    // reveals whether a given emp code exists.
    const genericFailure = new UnauthorizedException(
      'Invalid employee code or password',
    );

    const employee = await this.employees
      .createQueryBuilder('e')
      .where('LOWER(e.emp_code) = LOWER(:ec)', { ec: empCode })
      .getOne();

    if (!employee) {
      await this.verifyAgainstDummy(password);
      throw genericFailure;
    }

    const cred = await this.getOrCreateCredential(employee.id);

    if (cred.locked_until && cred.locked_until.getTime() > Date.now()) {
      throw new UnauthorizedException(
        'Account temporarily locked after repeated failed sign-in attempts. Try again later.',
      );
    }

    if (!cred.password_hash) {
      // Google-only employee, or one whose password hasn't been provisioned.
      await this.verifyAgainstDummy(password);
      throw genericFailure;
    }

    const passwordOk = await bcrypt.compare(password, cred.password_hash);
    if (!passwordOk) {
      await this.registerFailedAttempt(cred);
      throw genericFailure;
    }

    // Only reveal the inactive state once credentials are proven correct, so
    // it can't be used to probe which emp codes are valid.
    if (!employee.is_active) {
      throw new UnauthorizedException(
        'Your employee account is inactive. Please contact your institution.',
      );
    }

    // The password is proven — the lockout counter resets even if the device
    // limit pauses the login below.
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    return this.completeLogin(employee, cred, ctx, 'password');
  }

  // ---------------------------------------------------------------------------
  // Google sign-in
  // ---------------------------------------------------------------------------

  /**
   * Sign in with a Google ID token. Identity is established by Google; the
   * employee record must already exist (matched by email) — employees are
   * never auto-provisioned here. The Google subject is linked on first
   * sign-in and required to match afterwards. A Google session never carries
   * the must-change-password flag: it isn't a password login.
   */
  async loginWithGoogle(
    idToken: string,
    ctx: SessionContext = {},
  ): Promise<EmployeeLoginResult> {
    await this.enforceRateLimit(
      'login',
      ctx.ip ?? undefined,
      RATE_LIMITS.login,
    );

    const identity = await this.googleOidc.verifyIdToken(idToken);
    if (!identity.emailVerified) {
      throw new UnauthorizedException(
        'Your Google account email is not verified.',
      );
    }

    const employee = await this.employees
      .createQueryBuilder('e')
      .where('LOWER(e.email) = LOWER(:email)', { email: identity.email })
      .getOne();

    // Generic message — never reveal whether the email maps to an employee.
    if (!employee) {
      throw new UnauthorizedException(
        'This Google account is not linked to an employee.',
      );
    }
    if (!employee.is_active) {
      throw new UnauthorizedException(
        'Your employee account is inactive. Please contact your institution.',
      );
    }

    const cred = await this.getOrCreateCredential(employee.id);

    // Link the Google subject on first sign-in; require it to match on every
    // later sign-in so a Google-side email reassignment can't take over.
    if (cred.google_id && cred.google_id !== identity.sub) {
      throw new UnauthorizedException(
        'This Google account is not linked to an employee.',
      );
    }

    cred.google_id = identity.sub;
    await this.credentials.save(cred);

    return this.completeLogin(employee, cred, ctx, 'google');
  }

  // ---------------------------------------------------------------------------
  // Device limit
  // ---------------------------------------------------------------------------

  /**
   * Finish a login the device limit paused: sign the chosen devices out, then
   * run the same gate again. See `StudentAuthService.completeDeviceLimitLogin`
   * — identical semantics: account state is re-checked, foreign ids are
   * silent no-ops, and a still-limited retry keeps the same challenge.
   */
  async completeDeviceLimitLogin(
    input: DeviceLimitLoginInput,
    ctx: Pick<SessionContext, 'ip' | 'userAgent'> = {},
  ): Promise<EmployeeLoginResult> {
    await this.enforceRateLimit(
      'login',
      ctx.ip ?? undefined,
      RATE_LIMITS.login,
    );
    const invalid = new UnauthorizedException(
      'Your sign-in session has expired. Please sign in again.',
    );

    const challenge = await this.challenges.peek(input.challengeToken);
    if (!challenge || challenge.audience !== 'employee') throw invalid;

    const employee = await this.employees.findOne({
      where: { id: challenge.subjectId },
    });
    if (!employee || !employee.is_active) throw invalid;
    const cred = await this.getOrCreateCredential(employee.id);
    if (
      DeviceLimitChallengeService.supersededBy(
        challenge,
        cred.password_changed_at,
      )
    ) {
      throw invalid;
    }

    for (const id of new Set(input.sessionIds)) {
      await this.sessions.revokeById(
        'employee',
        employee.id,
        id,
        'device_limit',
      );
    }

    const result = await this.completeLogin(
      employee,
      cred,
      {
        deviceId: input.device_id,
        deviceName: input.device_name,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      challenge.method,
      input.challengeToken,
    );
    await this.challenges.consume(input.challengeToken);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Refresh — single-use rotation with token-reuse detection
  // ---------------------------------------------------------------------------

  async refresh(
    refreshToken: string,
    ip?: string,
  ): Promise<EmployeeAuthTokens> {
    let payload: EmployeeRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<EmployeeRefreshPayload>(
        refreshToken,
        {
          secret: this.config.getOrThrow<string>('JWT_EMPLOYEE_REFRESH_SECRET'),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Tokens minted before sessions existed carry no sid: sign in again.
    if (!payload.sid) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }

    const { session, refreshJti } = await this.sessions.rotateOnRefresh(
      'employee',
      payload.sid,
      payload.jti,
      { ip },
    );

    const employee = await this.employees.findOne({
      where: { id: session.subject_id },
    });
    if (!employee || !employee.is_active) {
      await this.sessions.revoke(session, 'deactivated');
      throw new UnauthorizedException('Account is no longer active');
    }

    const cred = await this.getOrCreateCredential(employee.id);
    return this.issueTokens(
      employee,
      cred.must_change_password,
      session.id,
      refreshJti,
    );
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  /** Sign out THIS device only; the employee's other devices stay signed in. */
  async logout(employeeId: number, sid: string): Promise<void> {
    await this.sessions.revokeById('employee', employeeId, sid, 'user');
  }

  // ---------------------------------------------------------------------------
  // Password change (forced first-login change and voluntary change)
  // ---------------------------------------------------------------------------

  async changePassword(
    employeeId: number,
    sid: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<EmployeeAuthTokens> {
    const employee = await this.employees.findOne({
      where: { id: employeeId },
    });
    if (!employee) throw new UnauthorizedException();

    const cred = await this.getOrCreateCredential(employeeId);
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

    // Sign every OTHER device out; the device that proved the password keeps
    // its session and gets a fresh pair without the must-change flag.
    await this.sessions.revokeAllExcept(
      'employee',
      employeeId,
      sid,
      'password_changed',
    );
    const { session, refreshJti } = await this.sessions.reissue(
      'employee',
      sid,
    );
    return this.issueTokens(employee, false, session.id, refreshJti);
  }

  // ---------------------------------------------------------------------------
  // Forgot / reset password (self-service, email-driven)
  // ---------------------------------------------------------------------------

  /**
   * Always resolves without indicating whether the identifier matched anyone —
   * the controller returns an identical response either way so the endpoint
   * cannot be used to enumerate employees.
   */
  async forgotPassword(identifier: string, ip?: string): Promise<void> {
    await this.enforceRateLimit('forgot-ip', ip, RATE_LIMITS.forgotByIp);
    await this.enforceRateLimit(
      'forgot-id',
      identifier.toLowerCase(),
      RATE_LIMITS.forgotByIdentifier,
    );

    const employee = await this.findEmployeeByIdentifier(identifier);
    if (!employee || !employee.is_active) return;

    await this.getOrCreateCredential(employee.id);

    const ttlSeconds = this.resetTokenTtlSeconds();
    const token = randomBytes(32).toString('base64url');
    await this.redis.set(
      this.resetKey(this.hashToken(token)),
      String(employee.id),
      'EX',
      ttlSeconds,
    );

    const resetUrl = this.buildEmployeeAppUrl({ 'reset-token': token });
    try {
      await this.mail.sendEmployeePasswordReset({
        to: employee.email,
        displayName: employee.emp_display_name,
        resetUrl,
        expiresInMinutes: Math.round(ttlSeconds / 60),
      });
    } catch (err) {
      this.logger.error(
        `Failed to send password-reset email for employee ${employee.id}: ${
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
    const employeeIdRaw = await this.redis.get(key);
    if (!employeeIdRaw) {
      throw new HttpException(
        'This password reset link is invalid or has expired.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.redis.del(key);

    const employeeId = Number(employeeIdRaw);
    const employee = await this.employees.findOne({
      where: { id: employeeId },
    });
    if (!employee || !employee.is_active) {
      throw new HttpException(
        'This password reset link is invalid or has expired.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const cred = await this.getOrCreateCredential(employeeId);
    cred.password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    cred.must_change_password = false;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    await this.sessions.revokeAllExcept(
      'employee',
      employeeId,
      null,
      'password_reset',
    );
  }

  // ---------------------------------------------------------------------------
  // Admin-initiated reset / provisioning
  // ---------------------------------------------------------------------------

  /**
   * Called from the admin module. Generates a random temporary password,
   * emails it to the employee's registered address, and forces a change on
   * first login. The password is only persisted once the email has been
   * accepted, so a delivery failure never strands the employee.
   */
  async adminResetPassword(employeeId: number): Promise<{ email: string }> {
    const employee = await this.employees.findOne({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const cred = await this.getOrCreateCredential(employeeId);

    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    await this.mail.sendEmployeeTempPassword({
      to: employee.email,
      displayName: employee.emp_display_name,
      empCode: employee.emp_code,
      tempPassword,
      loginUrl: this.buildEmployeeAppUrl(),
    });

    cred.password_hash = hash;
    cred.must_change_password = true;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    await this.sessions.revokeAllExcept(
      'employee',
      employeeId,
      null,
      'admin_password_reset',
    );

    return { email: employee.email };
  }

  /**
   * Admin sets an employee's password directly to a chosen value. No email is
   * sent — the admin shares it with the employee out-of-band. Like a reset it
   * forces a change on first login and revokes any active sessions.
   */
  async adminSetPassword(employeeId: number, password: string): Promise<void> {
    const employee = await this.employees.findOne({
      where: { id: employeeId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const cred = await this.getOrCreateCredential(employeeId);
    cred.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    cred.must_change_password = true;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    await this.sessions.revokeAllExcept(
      'employee',
      employeeId,
      null,
      'admin_password_reset',
    );
  }

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  async getProfile(employeeId: number): Promise<EmployeeProfile> {
    // The Employee entity eager-loads department and designation.
    const employee = await this.employees.findOne({
      where: { id: employeeId },
    });
    if (!employee) throw new UnauthorizedException();
    return {
      id: employee.id,
      emp_code: employee.emp_code,
      emp_display_name: employee.emp_display_name,
      email: employee.email,
      gender: employee.gender,
      mobile_number: employee.mobile_number,
      country_code: employee.country_code,
      is_active: employee.is_active,
      department: employee.department
        ? {
            id: employee.department.id,
            name: employee.department.name,
            code: employee.department.code,
          }
        : null,
      designation: employee.designation
        ? {
            id: employee.designation.id,
            name: employee.designation.name,
            code: employee.designation.code,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * The device-limit gate every login passes through — see
   * `StudentAuthService.completeLogin`. The limit is the employee's own
   * `device_limit` when an admin set one, else the global default.
   */
  private async completeLogin(
    employee: Employee,
    cred: EmployeeCredential,
    ctx: SessionContext,
    method: DeviceLimitChallenge['method'],
    reuseChallenge?: string,
  ): Promise<EmployeeLoginResult> {
    // A Google session never carries the must-change flag: it isn't a
    // password login.
    const mcp = method === 'password' ? cred.must_change_password : false;
    const outcome = await this.sessions.createWithinLimit(
      'employee',
      employee.id,
      employee.device_limit ?? DEFAULT_DEVICE_LIMIT,
      ctx,
    );
    if ('limited' in outcome) {
      const token =
        reuseChallenge ??
        (await this.challenges.issue({
          audience: 'employee',
          subjectId: employee.id,
          method,
        }));
      throwDeviceLimit(token, outcome.limit, outcome.active);
    }

    cred.last_login_at = new Date();
    cred.last_login_ip = ctx.ip ?? null;
    await this.credentials.save(cred);

    const tokens = await this.issueTokens(
      employee,
      mcp,
      outcome.session.id,
      outcome.refreshJti,
    );
    return {
      ...tokens,
      mustChangePassword: mcp,
      employee: this.toSummary(employee),
    };
  }

  /**
   * Sign a pair for one session. Both tokens carry the `sid`; the refresh
   * token's `jti` must match the session row's current `refresh_jti`.
   */
  private async issueTokens(
    employee: Employee,
    mustChangePassword: boolean,
    sid: string,
    refreshJti: string,
  ): Promise<EmployeeAuthTokens> {
    const accessPayload: EmployeeAccessPayload = {
      sub: employee.id,
      emp_code: employee.emp_code,
      mcp: mustChangePassword,
      sid,
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_EMPLOYEE_ACCESS_SECRET'),
      expiresIn: this.sessions.accessTtlSeconds('employee'),
    });

    const refreshToken = await this.jwt.signAsync(
      {
        sub: employee.id,
        sid,
        jti: refreshJti,
      } satisfies EmployeeRefreshPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_EMPLOYEE_REFRESH_SECRET'),
        expiresIn: this.sessions.refreshTtlSeconds('employee'),
      },
    );

    return { accessToken, refreshToken };
  }

  private async registerFailedAttempt(cred: EmployeeCredential): Promise<void> {
    cred.failed_login_attempts += 1;
    if (cred.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
      cred.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
      cred.failed_login_attempts = 0;
    }
    await this.credentials.save(cred);
  }

  private async getOrCreateCredential(
    employeeId: number,
  ): Promise<EmployeeCredential> {
    const existing = await this.credentials.findOne({
      where: { employee_id: employeeId },
    });
    if (existing) return existing;

    try {
      return await this.credentials.save(
        this.credentials.create({
          employee_id: employeeId,
          password_hash: null,
          must_change_password: true,
          failed_login_attempts: 0,
        }),
      );
    } catch {
      const row = await this.credentials.findOne({
        where: { employee_id: employeeId },
      });
      if (row) return row;
      throw new HttpException(
        'Could not initialise employee credentials',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async findEmployeeByIdentifier(
    identifier: string,
  ): Promise<Employee | null> {
    return this.employees
      .createQueryBuilder('e')
      .where('LOWER(e.emp_code) = LOWER(:id) OR LOWER(e.email) = LOWER(:id)', {
        id: identifier,
      })
      .getOne();
  }

  private async enforceRateLimit(
    bucket: string,
    subject: string | undefined,
    limit: { max: number; windowSeconds: number },
  ): Promise<void> {
    if (!subject) return;
    const key = `employee:rl:${bucket}:${subject}`;
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

  private toSummary(employee: Employee): EmployeeSummary {
    return {
      id: employee.id,
      emp_code: employee.emp_code,
      emp_display_name: employee.emp_display_name,
      email: employee.email,
    };
  }

  private resetKey(tokenHash: string): string {
    return `employee:pwreset:${tokenHash}`;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Build a URL into the employee portal, preserving any query string the
   * deployment baked into EMPLOYEE_APP_URL (e.g. `?app=employee` for the
   * localhost dev path that shares port :5000 with the student app). Merges
   * `extraSearchParams` on top of whatever is already there.
   */
  private buildEmployeeAppUrl(
    extraSearchParams?: Record<string, string>,
  ): string {
    const base = this.config.get<string>(
      'EMPLOYEE_APP_URL',
      'http://localhost:5000',
    );
    const url = new URL(base);
    if (extraSearchParams) {
      for (const [k, v] of Object.entries(extraSearchParams)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  }

  private resetTokenTtlSeconds(): number {
    return parseDurationToSeconds(
      this.config.get<string>('EMPLOYEE_PASSWORD_RESET_TTL', '30m'),
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

  const shuffle = randomBytes(chars.length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(input.trim());
  if (!match) return 30 * 24 * 60 * 60;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * mult[unit];
}
