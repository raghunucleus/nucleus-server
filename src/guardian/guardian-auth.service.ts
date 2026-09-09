import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { IsNull, Repository } from 'typeorm';
import { scanAndDelete } from '../common/session-keys';
import { REDIS_CLIENT } from '../redis/redis.module';
import { GuardianCredential } from './entities/guardian-credential.entity';
import { GuardianOtp } from './entities/guardian-otp.entity';
import {
  OTP_CHANNELS,
  OtpChannel,
  OtpTarget,
} from './auth/otp-channel/otp-channel.interface';
import {
  GuardianPortalService,
  LinkedStudent,
} from './portal/guardian-portal.service';

/** Claims carried by a guardian access token. The subject is the mobile number. */
export interface GuardianAccessPayload {
  sub: string; // mobile_number
  mcp: boolean; // must change password
}

interface GuardianRefreshPayload {
  sub: string; // mobile_number
  fid: string;
  jti: string;
}

export interface GuardianAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface GuardianSummary {
  mobile_number: string;
  display_name: string;
}

export interface GuardianLoginResult extends GuardianAuthTokens {
  mustChangePassword: boolean;
  guardian: GuardianSummary;
  students: LinkedStudent[];
}

export interface GuardianProfile extends GuardianSummary {
  students: LinkedStudent[];
}

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

const RATE_LIMITS = {
  login: { max: 200, windowSeconds: 15 * 60 },
  otpByIp: { max: 40, windowSeconds: 60 * 60 },
  otpByMobile: { max: 5, windowSeconds: 60 * 60 },
  verify: { max: 30, windowSeconds: 60 * 60 },
} as const;

@Injectable()
export class GuardianAuthService {
  private readonly logger = new Logger(GuardianAuthService.name);
  private dummyHashPromise: Promise<string> | null = null;

  constructor(
    @InjectRepository(GuardianCredential)
    private readonly credentials: Repository<GuardianCredential>,
    @InjectRepository(GuardianOtp)
    private readonly otps: Repository<GuardianOtp>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(OTP_CHANNELS) private readonly channels: OtpChannel[],
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly portal: GuardianPortalService,
  ) {}

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(
    mobileNumber: string,
    password: string,
    ip?: string,
  ): Promise<GuardianLoginResult> {
    await this.enforceRateLimit('login', ip, RATE_LIMITS.login);

    const genericFailure = new UnauthorizedException(
      'Invalid mobile number or password',
    );

    const cred = await this.credentials.findOne({
      where: { mobile_number: mobileNumber },
    });

    if (!cred || !cred.password_hash) {
      await this.verifyAgainstDummy(password);
      throw genericFailure;
    }

    if (cred.locked_until && cred.locked_until.getTime() > Date.now()) {
      throw new UnauthorizedException(
        'Account temporarily locked after repeated failed sign-in attempts. Try again later.',
      );
    }

    const passwordOk = await bcrypt.compare(password, cred.password_hash);
    if (!passwordOk) {
      await this.registerFailedAttempt(cred);
      throw genericFailure;
    }

    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    cred.last_login_at = new Date();
    cred.last_login_ip = ip ?? null;
    await this.credentials.save(cred);

    const tokens = await this.issueTokens(
      mobileNumber,
      cred.must_change_password,
      randomUUID(),
    );
    return {
      ...tokens,
      mustChangePassword: cred.must_change_password,
      guardian: {
        mobile_number: mobileNumber,
        display_name:
          (await this.portal.getDisplayName(mobileNumber)) ?? mobileNumber,
      },
      students: await this.portal.listStudents(mobileNumber),
    };
  }

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<GuardianAuthTokens> {
    let payload: GuardianRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<GuardianRefreshPayload>(
        refreshToken,
        {
          secret: this.config.getOrThrow<string>('JWT_GUARDIAN_REFRESH_SECRET'),
        },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const familyKey = this.familyKey(payload.sub, payload.fid);
    const currentJti = await this.redis.get(familyKey);

    if (!currentJti) {
      throw new UnauthorizedException(
        'Your session has expired. Please sign in again.',
      );
    }
    if (currentJti !== payload.jti) {
      await this.redis.del(familyKey);
      this.logger.warn(
        `Refresh-token reuse detected for guardian ${payload.sub}; family ${payload.fid} revoked`,
      );
      throw new UnauthorizedException(
        'Session security check failed. Please sign in again.',
      );
    }

    const cred = await this.credentials.findOne({
      where: { mobile_number: payload.sub },
    });
    return this.issueTokens(
      payload.sub,
      cred?.must_change_password ?? false,
      payload.fid,
    );
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  async logout(mobileNumber: string): Promise<void> {
    await scanAndDelete(this.redis, this.familyKey(mobileNumber, '*'));
  }

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  async getProfile(mobileNumber: string): Promise<GuardianProfile> {
    return {
      mobile_number: mobileNumber,
      display_name:
        (await this.portal.getDisplayName(mobileNumber)) ?? mobileNumber,
      students: await this.portal.listStudents(mobileNumber),
    };
  }

  // ---------------------------------------------------------------------------
  // Password change
  // ---------------------------------------------------------------------------

  async changePassword(
    mobileNumber: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<GuardianAuthTokens> {
    const cred = await this.credentials.findOne({
      where: { mobile_number: mobileNumber },
    });
    if (!cred || !cred.password_hash) throw new UnauthorizedException();

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

    await this.logout(mobileNumber);
    return this.issueTokens(mobileNumber, false, randomUUID());
  }

  // ---------------------------------------------------------------------------
  // OTP bootstrap / reset
  // ---------------------------------------------------------------------------

  async requestOtp(
    mobileNumber: string,
    requestedChannel: string | undefined,
    ip?: string,
  ): Promise<void> {
    await this.enforceRateLimit('otp-ip', ip, RATE_LIMITS.otpByIp);
    await this.enforceRateLimit(
      'otp-mobile',
      mobileNumber,
      RATE_LIMITS.otpByMobile,
    );

    // Only a number that is actually a guardian contact can get a code.
    if (!(await this.portal.hasAnyContact(mobileNumber))) return;

    const target: OtpTarget = {
      mobile_number: mobileNumber,
      display_name:
        (await this.portal.getDisplayName(mobileNumber)) ?? mobileNumber,
      email: await this.portal.getEmail(mobileNumber),
    };

    const channel = this.pickChannel(target, requestedChannel);
    if (!channel) {
      this.logger.warn(
        `No usable OTP channel for ${mobileNumber}; nothing sent.`,
      );
      return;
    }

    const ttlMinutes = this.otpTtlMinutes();
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');

    await this.otps.update(
      { mobile_number: mobileNumber, consumed_at: IsNull() },
      { consumed_at: new Date() },
    );
    await this.otps.save(
      this.otps.create({
        mobile_number: mobileNumber,
        otp_hash: this.hashOtp(otp),
        channel: channel.key,
        expires_at: new Date(Date.now() + ttlMinutes * 60_000),
        attempt_count: 0,
        consumed_at: null,
      }),
    );

    try {
      await channel.send(target, otp, ttlMinutes);
    } catch (err) {
      this.logger.error(
        `Failed to send guardian OTP for ${mobileNumber}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  async verifyOtpAndSetPassword(
    mobileNumber: string,
    otp: string,
    newPassword: string,
    ip?: string,
  ): Promise<void> {
    await this.enforceRateLimit('otp-verify', ip, RATE_LIMITS.verify);

    const invalid = new BadRequestException(
      'This code is invalid or has expired.',
    );

    if (!(await this.portal.hasAnyContact(mobileNumber))) throw invalid;

    const record = await this.otps
      .createQueryBuilder('o')
      .where('o.mobile_number = :mobile', { mobile: mobileNumber })
      .andWhere('o.consumed_at IS NULL')
      .andWhere('o.expires_at > now()')
      .orderBy('o.created_at', 'DESC')
      .getOne();

    if (!record || record.attempt_count >= OTP_MAX_ATTEMPTS) throw invalid;

    if (record.otp_hash !== this.hashOtp(otp)) {
      record.attempt_count += 1;
      await this.otps.save(record);
      throw invalid;
    }

    record.consumed_at = new Date();
    await this.otps.save(record);

    const cred = await this.getOrCreateCredential(mobileNumber);
    cred.password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    cred.must_change_password = false;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);

    await this.logout(mobileNumber);
  }

  // ---------------------------------------------------------------------------
  // Admin fallback
  // ---------------------------------------------------------------------------

  async adminSetPassword(
    mobileNumber: string,
    password: string,
  ): Promise<void> {
    const cred = await this.getOrCreateCredential(mobileNumber);
    cred.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    cred.must_change_password = true;
    cred.password_changed_at = new Date();
    cred.failed_login_attempts = 0;
    cred.locked_until = null;
    await this.credentials.save(cred);
    await this.logout(mobileNumber);
  }

  async adminTriggerOtp(mobileNumber: string): Promise<void> {
    await this.requestOtp(mobileNumber, undefined);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private pickChannel(
    target: OtpTarget,
    requested?: string,
  ): OtpChannel | null {
    if (requested) {
      const preferred = this.channels.find(
        (c) => c.key === requested && c.canSend(target),
      );
      if (preferred) return preferred;
    }
    return this.channels.find((c) => c.canSend(target)) ?? null;
  }

  private async issueTokens(
    mobileNumber: string,
    mustChangePassword: boolean,
    familyId: string,
  ): Promise<GuardianAuthTokens> {
    const accessPayload: GuardianAccessPayload = {
      sub: mobileNumber,
      mcp: mustChangePassword,
    };

    const accessTtl = parseDurationToSeconds(
      this.config.get<string>('JWT_GUARDIAN_ACCESS_TTL', '15m'),
    );
    const refreshTtl = parseDurationToSeconds(
      this.config.get<string>('JWT_GUARDIAN_REFRESH_TTL', '7d'),
    );

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_GUARDIAN_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });

    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      {
        sub: mobileNumber,
        fid: familyId,
        jti,
      } satisfies GuardianRefreshPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_GUARDIAN_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      },
    );

    await this.redis.set(
      this.familyKey(mobileNumber, familyId),
      jti,
      'EX',
      refreshTtl,
    );

    return { accessToken, refreshToken };
  }

  private async registerFailedAttempt(cred: GuardianCredential): Promise<void> {
    cred.failed_login_attempts += 1;
    if (cred.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
      cred.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60_000);
      cred.failed_login_attempts = 0;
    }
    await this.credentials.save(cred);
  }

  private async getOrCreateCredential(
    mobileNumber: string,
  ): Promise<GuardianCredential> {
    const existing = await this.credentials.findOne({
      where: { mobile_number: mobileNumber },
    });
    if (existing) return existing;
    try {
      return await this.credentials.save(
        this.credentials.create({
          mobile_number: mobileNumber,
          password_hash: null,
          must_change_password: false,
          failed_login_attempts: 0,
        }),
      );
    } catch {
      const row = await this.credentials.findOne({
        where: { mobile_number: mobileNumber },
      });
      if (row) return row;
      throw new HttpException(
        'Could not initialise guardian credentials',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async enforceRateLimit(
    bucket: string,
    subject: string | undefined,
    limit: { max: number; windowSeconds: number },
  ): Promise<void> {
    if (!subject) return;
    const key = `guardian:rl:${bucket}:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, limit.windowSeconds);
    if (count > limit.max) {
      throw new HttpException(
        'Too many requests. Please wait a while and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async verifyAgainstDummy(password: string): Promise<void> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = bcrypt.hash(randomUUID(), BCRYPT_ROUNDS);
    }
    await bcrypt.compare(password, await this.dummyHashPromise);
  }

  private familyKey(mobileNumber: string, familyId: string): string {
    return `guardian:rt:${mobileNumber}:${familyId}`;
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  private otpTtlMinutes(): number {
    return Math.max(
      1,
      Math.round(
        parseDurationToSeconds(
          this.config.get<string>('GUARDIAN_OTP_TTL', '10m'),
        ) / 60,
      ),
    );
  }
}

function parseDurationToSeconds(input: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(input.trim());
  if (!match) return 7 * 24 * 60 * 60;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * mult[unit];
}
