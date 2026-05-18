import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { REDIS_CLIENT } from '../redis/redis.module';
import { GoogleOidcService } from './auth/google-oidc.service';
import { TotpService } from './auth/totp.service';
import { AdminRecoveryCode } from './entities/admin-recovery-code.entity';
import { Admin } from './entities/admin.entity';

export interface AdminAccessPayload {
  sub: string;
  username: string;
  email: string;
  totp_pending: boolean;
}

interface AdminRefreshPayload {
  sub: string;
  jti: string;
}

export interface AdminAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type LoginResult =
  | (AdminAuthTokens & { twoFactorRequired?: false; requiresTotpSetup: boolean })
  | { twoFactorRequired: true; challengeToken: string };

const BCRYPT_ROUNDS = 12;
const TOTP_ISSUER = 'Nucleus Admin';
const CHALLENGE_TTL_SECONDS = 5 * 60;
const CHALLENGE_MAX_ATTEMPTS = 5;

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    @InjectRepository(AdminRecoveryCode)
    private readonly recoveryCodes: Repository<AdminRecoveryCode>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly totp: TotpService,
    private readonly googleOidc: GoogleOidcService,
  ) {}

  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  async login(identifier: string, password: string): Promise<LoginResult> {
    const admin = await this.admins
      .createQueryBuilder('a')
      .where('a.email = :id OR a.username = :id', { id: identifier })
      .getOne();

    if (!admin) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (!admin.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (this.isDevMode()) {
      const tokens = await this.issueTokens(admin, { totpPending: false });
      return { ...tokens, requiresTotpSetup: false };
    }

    if (admin.totp_enabled_at) {
      const challengeToken = await this.issueLoginChallenge(admin.id);
      return { twoFactorRequired: true, challengeToken };
    }

    // 2FA is required for all admins, but the user hasn't enrolled yet.
    // Issue tokens scoped with totp_pending so the UI can force enrolment and
    // the server can reject sensitive routes via RequireTotpEnrolledGuard.
    const tokens = await this.issueTokens(admin, { totpPending: true });
    return { ...tokens, requiresTotpSetup: true };
  }

  // Google OIDC login. Identity is established by verifying the Google ID
  // token; the local admin record must already exist (matched by email). On
  // first sign-in we link the Google "sub" to the admin row; thereafter we
  // require the linked sub to match, so a future email reassignment on the
  // Google side cannot impersonate an existing admin.
  async loginWithGoogle(idToken: string): Promise<LoginResult> {
    const identity = await this.googleOidc.verifyIdToken(idToken);

    if (!identity.emailVerified) {
      throw new UnauthorizedException(
        'Google account email is not verified',
      );
    }

    const admin = await this.admins
      .createQueryBuilder('a')
      .where('LOWER(a.email) = LOWER(:email)', { email: identity.email })
      .getOne();

    // Generic message — do not leak whether an email is registered.
    if (!admin) throw new UnauthorizedException('Invalid Google credential');

    if (admin.google_id && admin.google_id !== identity.sub) {
      throw new UnauthorizedException('Invalid Google credential');
    }

    if (!admin.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (!admin.google_id) {
      admin.google_id = identity.sub;
      await this.admins.save(admin);
    }

    if (this.isDevMode()) {
      const tokens = await this.issueTokens(admin, { totpPending: false });
      return { ...tokens, requiresTotpSetup: false };
    }

    if (admin.totp_enabled_at) {
      const challengeToken = await this.issueLoginChallenge(admin.id);
      return { twoFactorRequired: true, challengeToken };
    }

    // 2FA still mandatory: issue tokens scoped with totp_pending so the UI
    // forces enrolment, mirroring the password-login path.
    const tokens = await this.issueTokens(admin, { totpPending: true });
    return { ...tokens, requiresTotpSetup: true };
  }

  async verifyTwoFactor(challengeToken: string, code: string): Promise<AdminAuthTokens> {
    const adminId = await this.peekLoginChallenge(challengeToken);
    if (!adminId) throw new UnauthorizedException('Challenge expired or invalid');

    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin || !admin.totp_enabled_at || !admin.totp_secret) {
      await this.clearLoginChallenge(challengeToken);
      throw new UnauthorizedException('Two-factor authentication is not configured');
    }
    if (!admin.is_active) {
      await this.clearLoginChallenge(challengeToken);
      throw new UnauthorizedException('Account is deactivated');
    }

    const accepted = await this.consumeTwoFactorCode(admin, code);
    if (!accepted) {
      const attempts = await this.recordChallengeAttempt(challengeToken);
      if (attempts >= CHALLENGE_MAX_ATTEMPTS) {
        await this.clearLoginChallenge(challengeToken);
        throw new UnauthorizedException('Too many invalid codes. Please sign in again.');
      }
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.clearLoginChallenge(challengeToken);
    return this.issueTokens(admin, { totpPending: false });
  }

  async refresh(refreshToken: string): Promise<AdminAuthTokens> {
    let payload: AdminRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminRefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_ADMIN_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const key = this.refreshKey(payload.sub, payload.jti);
    const exists = await this.redis.del(key); // single-use: rotate by deleting
    if (!exists) throw new UnauthorizedException('Refresh token revoked');

    const admin = await this.admins.findOne({ where: { id: payload.sub } });
    if (!admin) throw new UnauthorizedException('Admin no longer exists');
    if (!admin.is_active) {
      throw new UnauthorizedException('Account is deactivated');
    }

    return this.issueTokens(admin, { totpPending: !admin.totp_enabled_at });
  }

  async logout(adminId: string, jti?: string): Promise<void> {
    if (jti) {
      await this.redis.del(this.refreshKey(adminId, jti));
      return;
    }
    // No jti supplied: revoke every refresh token for this admin.
    const pattern = this.refreshKey(adminId, '*');
    const stream = this.redis.scanStream({ match: pattern, count: 100 });
    for await (const keys of stream) {
      if ((keys as string[]).length) await this.redis.del(...(keys as string[]));
    }
  }

  async changePassword(
    adminId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();

    const ok = await bcrypt.compare(oldPassword, admin.password_hash);
    if (!ok) throw new UnauthorizedException('Old password is incorrect');

    if (oldPassword === newPassword) {
      throw new ConflictException('New password must differ from the old one');
    }

    admin.password_hash = await AdminService.hashPassword(newPassword);
    await this.admins.save(admin);

    // Invalidate all existing refresh tokens after password change.
    await this.logout(adminId);
  }

  async getProfile(adminId: string): Promise<Omit<Admin, 'password_hash' | 'totp_secret' | 'syncDisplayName'>> {
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();
    return this.toPublicProfile(admin);
  }

  async updateProfile(
    adminId: string,
    patch: {
      email?: string;
      first_name?: string | null;
      last_name?: string | null;
      country_code?: string | null;
      mobile_number?: string | null;
    },
  ): Promise<Omit<Admin, 'password_hash' | 'totp_secret' | 'syncDisplayName'>> {
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();

    if (patch.email !== undefined && patch.email !== admin.email) {
      const existing = await this.admins
        .createQueryBuilder('a')
        .where('LOWER(a.email) = LOWER(:email) AND a.id != :id', {
          email: patch.email,
          id: adminId,
        })
        .getOne();
      if (existing) throw new ConflictException('Email is already in use');
      admin.email = patch.email;
    }

    if (patch.first_name !== undefined) admin.first_name = patch.first_name;
    if (patch.last_name !== undefined) admin.last_name = patch.last_name;
    if (patch.country_code !== undefined) admin.country_code = patch.country_code;
    if (patch.mobile_number !== undefined) admin.mobile_number = patch.mobile_number;

    // Keep country_code consistent with mobile_number: clear when local is cleared,
    // and default to India ('91') when a number is set without an explicit code.
    if (admin.mobile_number === null) {
      admin.country_code = null;
    } else if (!admin.country_code) {
      admin.country_code = '91';
    }

    // syncDisplayName() runs via @BeforeUpdate on save
    const saved = await this.admins.save(admin);
    return this.toPublicProfile(saved);
  }

  async setupTotp(
    adminId: string,
  ): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();
    if (admin.totp_enabled_at) {
      throw new ConflictException(
        'Two-factor authentication is already enabled. Disable it first to re-enrol.',
      );
    }

    const secret = this.totp.generateSecret();
    admin.totp_secret = secret;
    await this.admins.save(admin);

    const otpauthUrl = this.totp.buildOtpauthUrl(secret, admin.email, TOTP_ISSUER);
    const qrDataUrl = await this.totp.generateQrDataUrl(otpauthUrl);
    return { secret, otpauthUrl, qrDataUrl };
  }

  async enableTotp(
    adminId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[]; tokens: AdminAuthTokens }> {
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();
    if (admin.totp_enabled_at) {
      throw new ConflictException('Two-factor authentication is already enabled.');
    }
    if (!admin.totp_secret) {
      throw new BadRequestException(
        'No pending TOTP secret. Call /admin/totp/setup first.',
      );
    }

    const codeOk = await this.totp.verifyToken(admin.totp_secret, code);
    if (!codeOk) {
      throw new UnauthorizedException('Invalid verification code');
    }

    admin.totp_enabled_at = new Date();
    await this.admins.save(admin);

    // Replace any leftover codes from a previous enrolment, then issue fresh ones.
    await this.recoveryCodes.delete({ admin_id: admin.id as unknown as number });
    const plaintextCodes = this.totp.generateRecoveryCodes();
    const rows = await Promise.all(
      plaintextCodes.map(async (plain) => {
        const code_hash = await bcrypt.hash(this.totp.normalizeRecoveryCode(plain), BCRYPT_ROUNDS);
        return this.recoveryCodes.create({
          admin_id: admin.id as unknown as number,
          code_hash,
        });
      }),
    );
    await this.recoveryCodes.save(rows);

    // Existing refresh tokens were issued with totp_pending=true. Rotate so the
    // admin gets full-access tokens and any other sessions are revoked.
    await this.logout(admin.id);
    const tokens = await this.issueTokens(admin, { totpPending: false });

    return { recoveryCodes: plaintextCodes, tokens };
  }

  async disableTotp(adminId: string, password: string, code: string): Promise<void> {
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();
    if (!admin.totp_enabled_at || !admin.totp_secret) {
      throw new ConflictException('Two-factor authentication is not enabled.');
    }

    const passwordOk = await bcrypt.compare(password, admin.password_hash);
    if (!passwordOk) throw new UnauthorizedException('Password is incorrect');

    const codeOk = await this.consumeTwoFactorCode(admin, code);
    if (!codeOk) throw new UnauthorizedException('Invalid verification code');

    admin.totp_secret = null;
    admin.totp_enabled_at = null;
    await this.admins.save(admin);
    await this.recoveryCodes.delete({ admin_id: admin.id as unknown as number });
  }

  private async issueLoginChallenge(adminId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await this.redis.set(
      this.challengeKey(token),
      String(adminId),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
    return token;
  }

  private async peekLoginChallenge(token: string): Promise<string | null> {
    if (!token) return null;
    const adminId = await this.redis.get(this.challengeKey(token));
    return adminId ?? null;
  }

  private async clearLoginChallenge(token: string): Promise<void> {
    if (!token) return;
    await this.redis.del(this.challengeKey(token), this.challengeAttemptsKey(token));
  }

  private async recordChallengeAttempt(token: string): Promise<number> {
    const key = this.challengeAttemptsKey(token);
    const attempts = await this.redis.incr(key);
    if (attempts === 1) {
      await this.redis.expire(key, CHALLENGE_TTL_SECONDS);
    }
    return attempts;
  }

  // Accepts a 6-digit TOTP code or an 8-char recovery code (with optional dash).
  // Recovery codes are single-use and marked used_at on success.
  private async consumeTwoFactorCode(admin: Admin, code: string): Promise<boolean> {
    if (!admin.totp_secret) return false;
    const trimmed = code.trim();

    if (/^\d{6}$/.test(trimmed)) {
      return await this.totp.verifyToken(admin.totp_secret, trimmed);
    }

    const normalized = this.totp.normalizeRecoveryCode(trimmed);
    if (!/^[A-Z0-9]{8}$/.test(normalized)) return false;

    const candidates = await this.recoveryCodes.find({
      where: { admin_id: admin.id as unknown as number },
    });
    for (const candidate of candidates) {
      if (candidate.used_at) continue;
      const matches = await bcrypt.compare(normalized, candidate.code_hash);
      if (matches) {
        candidate.used_at = new Date();
        await this.recoveryCodes.save(candidate);
        return true;
      }
    }
    return false;
  }

  private async issueTokens(
    admin: Admin,
    opts: { totpPending: boolean },
  ): Promise<AdminAuthTokens> {
    const accessPayload: AdminAccessPayload = {
      sub: admin.id,
      username: admin.username,
      email: admin.email,
      totp_pending: opts.totpPending,
    };

    const accessTtl = parseDurationToSeconds(
      this.config.get<string>('JWT_ADMIN_ACCESS_TTL', '15m'),
    );
    const refreshTtl = parseDurationToSeconds(
      this.config.get<string>('JWT_ADMIN_REFRESH_TTL', '7d'),
    );

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ADMIN_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });

    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: admin.id, jti } satisfies AdminRefreshPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_ADMIN_REFRESH_SECRET'),
        expiresIn: refreshTtl,
      },
    );

    await this.redis.set(this.refreshKey(admin.id, jti), '1', 'EX', refreshTtl);

    return { accessToken, refreshToken };
  }

  private toPublicProfile(
    admin: Admin,
  ): Omit<Admin, 'password_hash' | 'totp_secret' | 'syncDisplayName'> {
    const { password_hash: _ph, totp_secret: _ts, ...rest } = admin;
    return rest;
  }

  private refreshKey(adminId: string, jti: string): string {
    return `admin:refresh:${adminId}:${jti}`;
  }

  private challengeKey(token: string): string {
    return `admin:2fa-challenge:${token}`;
  }

  private challengeAttemptsKey(token: string): string {
    return `admin:2fa-challenge-attempts:${token}`;
  }

  private isDevMode(): boolean {
    return this.config.get<string>('NODE_ENV') === 'dev';
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
