import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { parseDurationToSeconds } from '../common/parse-duration';
import {
  SecurityPassKind,
  SecurityPassPayload,
  SecurityPassResponse,
} from '../common/security-pass';
import { REDIS_CLIENT } from '../redis/redis.module';

type ConsumeResult =
  | { ok: true; kind: SecurityPassKind; sub: number; code: string }
  | { ok: false; reason: 'expired' | 'invalid' };

/**
 * Atomic compare-and-delete: delete the key only if it still holds THIS jti.
 * Returns 1 when consumed (the valid first scan), 0 otherwise (already used,
 * superseded by a Regenerate, or expired). A plain GETDEL would be wrong — it
 * would wipe a live pass even when a stale/forged jti is presented.
 */
const CONSUME_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Issues and verifies single-use, short-lived security passes. The signed JWT
 * is the QR payload; a per-person Redis key (value = the token's jti) makes the
 * pass single-use and lets a re-issue (Regenerate) instantly invalidate the
 * previous one. The Redis key carries the same TTL as the JWT, so an unscanned
 * pass auto-expires — the entry is gone the moment it is scanned OR at TTL,
 * whichever comes first.
 */
@Injectable()
export class SecurityPassService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Issue a pass for a person. Overwrites any prior pass for the same person. */
  async issue(
    kind: SecurityPassKind,
    sub: number,
    code: string,
  ): Promise<SecurityPassResponse> {
    const ttlSeconds = this.ttlSeconds();
    const jti = randomUUID();
    const payload: SecurityPassPayload = {
      kind,
      sub,
      code,
      typ: 'security-pass',
      jti,
    };
    const qr_token = await this.jwt.signAsync(payload, {
      secret: this.secret(),
      expiresIn: ttlSeconds,
    });
    await this.redis.set(this.key(kind, sub), jti, 'PX', ttlSeconds * 1000);
    return {
      qr_token,
      ttl_seconds: ttlSeconds,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /**
   * Verify a scanned pass and atomically consume it (single-use). Returns the
   * decoded identity refs on success, or a structured reason on failure. The
   * pass is burned here for every successful signature+freshness match — so a
   * scanned code is never replayable, even for an inactive/unknown person.
   */
  async consume(qrToken: string): Promise<ConsumeResult> {
    let payload: SecurityPassPayload;
    try {
      payload = await this.jwt.verifyAsync<SecurityPassPayload>(qrToken, {
        secret: this.secret(),
      });
    } catch (err) {
      const expired = err instanceof Error && err.name === 'TokenExpiredError';
      return { ok: false, reason: expired ? 'expired' : 'invalid' };
    }
    if (payload.typ !== 'security-pass' || !payload.jti) {
      return { ok: false, reason: 'invalid' };
    }
    const consumed = (await this.redis.eval(
      CONSUME_LUA,
      1,
      this.key(payload.kind, payload.sub),
      payload.jti,
    )) as number;
    // 0 means the key no longer holds this jti: already scanned, superseded by
    // a Regenerate, or TTL-expired — all surface as a stale pass to the guard.
    if (consumed !== 1) return { ok: false, reason: 'expired' };
    return {
      ok: true,
      kind: payload.kind,
      sub: payload.sub,
      code: payload.code,
    };
  }

  private key(kind: SecurityPassKind, sub: number): string {
    return `secpass:${kind}:${sub}`;
  }

  private secret(): string {
    return this.config.getOrThrow<string>('SECURITY_PASS_SECRET');
  }

  private ttlSeconds(): number {
    return parseDurationToSeconds(
      this.config.get<string>('SECURITY_PASS_TTL'),
      60,
    );
  }
}
