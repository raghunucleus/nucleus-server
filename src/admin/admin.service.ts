import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Admin } from './entities/admin.entity';

export interface AdminAccessPayload {
  sub: string;
  username: string;
  email: string;
}

interface AdminRefreshPayload {
  sub: string;
  jti: string;
}

export interface AdminAuthTokens {
  accessToken: string;
  refreshToken: string;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  static hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  async login(identifier: string, password: string): Promise<AdminAuthTokens> {
    const admin = await this.admins
      .createQueryBuilder('a')
      .where('a.email = :id OR a.username = :id', { id: identifier })
      .getOne();

    if (!admin) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(admin);
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

    return this.issueTokens(admin);
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

  async getProfile(adminId: string): Promise<Omit<Admin, 'password_hash'>> {
    const admin = await this.admins.findOne({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();
    const { password_hash: _ph, ...rest } = admin;
    return rest;
  }

  private async issueTokens(admin: Admin): Promise<AdminAuthTokens> {
    const accessPayload: AdminAccessPayload = {
      sub: admin.id,
      username: admin.username,
      email: admin.email,
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

  private refreshKey(adminId: string, jti: string): string {
    return `admin:refresh:${adminId}:${jti}`;
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
