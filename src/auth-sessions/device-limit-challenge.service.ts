import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { SessionAudience } from './auth-session.entity';
import { DEVICE_LIMIT_CHALLENGE_TTL_SECONDS } from './session.constants';

/** What a device-limit challenge token resolves to. */
export interface DeviceLimitChallenge {
  audience: SessionAudience;
  /** `students.id` / `employees.id` / `guardian_credentials.id`. */
  subjectId: number;
  /**
   * How the paused login was proven. A Google login never carries the
   * must-change-password flag, so finishing one through the picker must not
   * either.
   */
  method: 'password' | 'google';
  /**
   * Epoch ms the challenge was minted. A password set after this (reset,
   * admin set, invite) invalidates it — the credential it vouches for is gone.
   */
  issuedAt: number;
}

/**
 * Server-side state for a login the device limit paused. The token stands in
 * for a fully proven authentication for a few minutes — long enough to pick a
 * device to sign out, and nothing more: it can only complete THIS login.
 * Opaque random token; its SHA-256 is the Redis key, so a leaked key dump
 * yields nothing usable.
 */
@Injectable()
export class DeviceLimitChallengeService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async issue(
    challenge: Omit<DeviceLimitChallenge, 'issuedAt'>,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const payload: DeviceLimitChallenge = {
      ...challenge,
      issuedAt: Date.now(),
    };
    await this.redis.set(
      this.key(token),
      JSON.stringify(payload),
      'EX',
      DEVICE_LIMIT_CHALLENGE_TTL_SECONDS,
    );
    return token;
  }

  /** Look up a challenge without consuming it. */
  async peek(token: string): Promise<DeviceLimitChallenge | null> {
    const raw = await this.redis.get(this.key(token));
    return raw ? (JSON.parse(raw) as DeviceLimitChallenge) : null;
  }

  /** Delete the challenge once the login it paused has completed. */
  async consume(token: string): Promise<void> {
    await this.redis.del(this.key(token));
  }

  /** True when a password was (re)set after the challenge was minted. */
  static supersededBy(
    challenge: DeviceLimitChallenge,
    passwordChangedAt: Date | null | undefined,
  ): boolean {
    return (
      !!passwordChangedAt && passwordChangedAt.getTime() > challenge.issuedAt
    );
  }

  private key(token: string): string {
    return `auth:devlimit:${createHash('sha256').update(token).digest('hex')}`;
  }
}
