import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { parseDurationToSeconds } from '../common/parse-duration';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  AuthSession,
  SessionAudience,
  SessionRevokedReason,
} from './auth-session.entity';
import { resolveDeviceName } from './device-metadata.util';
import { SessionSocketRegistry } from './session-socket-registry';
import {
  ROTATION_GRACE_SECONDS,
  SESSION_TTL_CONFIG,
  revokedSidKey,
} from './session.constants';

/** Where a login came from, as the controller captured it. */
export interface SessionContext {
  deviceId?: string | null;
  deviceName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** A session was created (or rotated): the row plus its current refresh jti. */
export interface IssuedSession {
  session: AuthSession;
  refreshJti: string;
}

/** The device limit blocked the login; `active` are the occupying sessions. */
export interface LimitReached {
  limited: true;
  active: AuthSession[];
  limit: number;
}

export type CreateSessionResult = IssuedSession | LimitReached;

/**
 * One row as "My devices" and the admin sessions view consume it. `ip` is
 * only present for the admin view.
 */
export interface SessionRow {
  id: string;
  device_name: string;
  ip?: string | null;
  created_at: string;
  last_used_at: string;
  current: boolean;
}

const SESSION_ENDED = 'Your session has ended. Please sign in again.';

/**
 * The server-side identity of every student, employee and parent login —
 * ported from central's `EmployeeSessionsService`, generalised over the three
 * audiences. Owns the whole lifecycle: creation under the device limit,
 * refresh rotation (with the concurrent-refresh grace window), and revocation
 * with its three fan-outs — the row, the Redis sid denylist the JWT strategies
 * check per request, and the socket disconnect. Everything after the row
 * write is best-effort: a Redis or socket hiccup degrades a kill to "bites at
 * the next refresh", it never fails the caller's request.
 *
 * The ONLY place that may mint a session or write the denylist key. Any code
 * that invalidates a credential (reset, admin set, accepted invite, OTP) must
 * end with `revokeAllExcept`.
 */
@Injectable()
export class AuthSessionsService {
  private readonly logger = new Logger(AuthSessionsService.name);

  constructor(
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly registry: SessionSocketRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * One UNREVOKED, unexpired session, scoped to its owner — so a foreign id is
   * indistinguishable from an unknown one.
   */
  findLive(
    audience: SessionAudience,
    subjectId: number,
    sessionId: string,
  ): Promise<AuthSession | null> {
    return this.sessions.findOne({
      where: {
        id: sessionId,
        audience,
        subject_id: subjectId,
        revoked_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
    });
  }

  /** This subject's live sessions, most recently active first. */
  listActive(
    audience: SessionAudience,
    subjectId: number,
  ): Promise<AuthSession[]> {
    return this.sessions.find({
      where: {
        audience,
        subject_id: subjectId,
        revoked_at: IsNull(),
        expires_at: MoreThan(new Date()),
      },
      order: { last_used_at: 'DESC' },
    });
  }

  /**
   * The list "My devices" (no IP) and the admin view (with IP) render. The set
   * is bounded by the device limit, so it is a plain array, not a page.
   */
  async list(
    audience: SessionAudience,
    subjectId: number,
    opts: { currentSid?: string; includeIp?: boolean } = {},
  ): Promise<SessionRow[]> {
    const rows = await this.listActive(audience, subjectId);
    return rows.map((s) => ({
      id: s.id,
      device_name: s.device_name,
      ...(opts.includeIp ? { ip: s.ip } : {}),
      created_at: s.created_at.toISOString(),
      last_used_at: s.last_used_at.toISOString(),
      current: opts.currentSid !== undefined && s.id === opts.currentSid,
    }));
  }

  // ---------------------------------------------------------------------------
  // Create (login)
  // ---------------------------------------------------------------------------

  /**
   * Start a session for a proven login, enforcing the device limit.
   *
   * Serialized per subject by a transaction-scoped advisory lock (there is no
   * single row to `FOR UPDATE` across three audiences), so two concurrent
   * logins cannot both squeeze under the limit; the partial unique index on
   * (audience, subject_id, device_id) is the schema-level backstop for the
   * same-device case.
   *
   * A live session for the SAME device is replaced rather than counted — a
   * re-login from the browser or phone you are already signed in on must
   * never burn a second slot.
   */
  async createWithinLimit(
    audience: SessionAudience,
    subjectId: number,
    limit: number,
    ctx: SessionContext,
  ): Promise<CreateSessionResult> {
    const now = new Date();
    const ttlMs = this.refreshTtlSeconds(audience) * 1000;
    const deviceId = ctx.deviceId?.trim().slice(0, 64) || null;
    const deviceName = resolveDeviceName(ctx.deviceName, ctx.userAgent);

    const outcome = await this.sessions.manager.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `auth_sessions:${audience}:${subjectId}`,
      ]);
      const repo = m.getRepository(AuthSession);
      // Every unrevoked row: live ones count toward the limit; an EXPIRED
      // unrevoked row no longer counts but still holds the device_id slot in
      // the partial unique index, so same-device replacement must cover it.
      const unrevoked = await repo.find({
        where: { audience, subject_id: subjectId, revoked_at: IsNull() },
        order: { last_used_at: 'DESC' },
      });
      const sameDevice = deviceId
        ? unrevoked.filter((s) => s.device_id === deviceId)
        : [];
      for (const old of sameDevice) {
        await repo.update(old.id, {
          revoked_at: now,
          revoked_reason: 'replaced',
          refresh_jti: null,
          prev_refresh_jti: null,
        });
      }
      const active = unrevoked.filter(
        (s) => !sameDevice.includes(s) && s.expires_at > now,
      );
      if (active.length >= limit) {
        return { limited: true as const, active, limit };
      }
      const refreshJti = randomUUID();
      const session = await repo.save(
        repo.create({
          audience,
          subject_id: subjectId,
          device_id: deviceId,
          device_name: deviceName,
          ip: ctx.ip?.slice(0, 64) ?? null,
          user_agent: ctx.userAgent?.slice(0, 512) ?? null,
          refresh_jti: refreshJti,
          last_used_at: now,
          expires_at: new Date(now.getTime() + ttlMs),
        }),
      );
      return { session, refreshJti, replaced: sameDevice };
    });

    if ('limited' in outcome) return outcome;

    // The replaced sessions' outstanding tokens die now, not at expiry — an
    // old tab of this very device may still hold them.
    for (const old of outcome.replaced) {
      this.denySidAndDisconnect(old);
    }
    return { session: outcome.session, refreshJti: outcome.refreshJti };
  }

  // ---------------------------------------------------------------------------
  // Refresh rotation
  // ---------------------------------------------------------------------------

  /**
   * Validate + rotate on refresh. The presented jti must be the session's
   * current one — or, within {@link ROTATION_GRACE_SECONDS} of the last
   * rotation, the previous one (a concurrent refresh lost the race). A grace
   * hit gets fresh tokens carrying the CURRENT jti without another rotation,
   * so every caller converges on one refresh token. Any other mismatch is a
   * replay of a rotated-out token: the session is burned.
   *
   * The rotation itself is a single conditional UPDATE (compare-and-swap on
   * `refresh_jti`), not central's read-compare-save: two refreshes presenting
   * the same jti can then never both rotate — exactly one wins and the other
   * falls through to the grace path.
   */
  async rotateOnRefresh(
    audience: SessionAudience,
    sid: string,
    presentedJti: string | undefined,
    ctx: Pick<SessionContext, 'ip'> = {},
  ): Promise<IssuedSession> {
    const ended = new UnauthorizedException(SESSION_ENDED);
    if (!presentedJti) throw ended;

    const now = new Date();
    const nextJti = randomUUID();
    const rotated = await this.sessions
      .createQueryBuilder()
      .update(AuthSession)
      .set({
        prev_refresh_jti: () => '"refresh_jti"',
        refresh_jti: nextJti,
        rotated_at: now,
        last_used_at: now,
        expires_at: new Date(
          now.getTime() + this.refreshTtlSeconds(audience) * 1000,
        ),
        // Keep the stored address current — a laptop that moves networks
        // shows where it is NOW in the admin view, not where it signed in.
        ...(ctx.ip ? { ip: ctx.ip.slice(0, 64) } : {}),
      })
      .where('"id" = :sid', { sid })
      .andWhere('"audience" = :audience', { audience })
      .andWhere('"refresh_jti" = :jti', { jti: presentedJti })
      .andWhere('"revoked_at" IS NULL')
      .andWhere('"expires_at" > now()')
      .execute();

    if (rotated.affected) {
      const session = await this.sessions.findOne({ where: { id: sid } });
      if (!session) throw ended;
      return { session, refreshJti: nextJti };
    }

    // Not the current jti (or the session is dead). Decide which.
    const session = await this.sessions.findOne({
      where: { id: sid, audience },
    });
    if (
      !session ||
      session.revoked_at ||
      !session.refresh_jti ||
      session.expires_at <= now
    ) {
      throw ended;
    }
    const inGrace =
      session.prev_refresh_jti === presentedJti &&
      session.rotated_at !== null &&
      now.getTime() - session.rotated_at.getTime() <=
        ROTATION_GRACE_SECONDS * 1000;
    if (!inGrace) {
      // A rotated-out token outside the grace window: either a stolen copy or
      // a replay. Burn the session rather than re-issue — the legitimate
      // holder signs in again; the thief gets nothing.
      this.logger.warn(
        `Refresh-token reuse detected for ${audience} session ${session.id} ` +
          `(subject ${session.subject_id}) — revoking the session.`,
      );
      await this.revoke(session, 'reuse_detected');
      throw ended;
    }
    await this.sessions.update(session.id, { last_used_at: now });
    return { session, refreshJti: session.refresh_jti };
  }

  /**
   * Rotate the current session's refresh jti outside a refresh — used by
   * change-password, which hands the caller a fresh pair (without the
   * must-change flag) on the SAME session. The old jti stays honoured for the
   * grace window like any rotation.
   */
  async reissue(
    audience: SessionAudience,
    sid: string,
  ): Promise<IssuedSession> {
    const session = await this.sessions.findOne({
      where: { id: sid, audience, revoked_at: IsNull() },
    });
    if (!session || !session.refresh_jti) {
      throw new UnauthorizedException(SESSION_ENDED);
    }
    const now = new Date();
    session.prev_refresh_jti = session.refresh_jti;
    session.refresh_jti = randomUUID();
    session.rotated_at = now;
    session.last_used_at = now;
    session.expires_at = new Date(
      now.getTime() + this.refreshTtlSeconds(audience) * 1000,
    );
    await this.sessions.save(session);
    return { session, refreshJti: session.refresh_jti };
  }

  // ---------------------------------------------------------------------------
  // Revocation
  // ---------------------------------------------------------------------------

  /** End one session. Idempotent; everything past the row write is best-effort. */
  async revoke(
    session: AuthSession,
    reason: SessionRevokedReason,
  ): Promise<void> {
    if (session.revoked_at) return;
    const now = new Date();
    const res = await this.sessions.update(
      { id: session.id, revoked_at: IsNull() },
      {
        revoked_at: now,
        revoked_reason: reason,
        refresh_jti: null,
        prev_refresh_jti: null,
      },
    );
    session.revoked_at = now;
    session.revoked_reason = reason;
    session.refresh_jti = null;
    session.prev_refresh_jti = null;
    // Lost a race with another revoke — that one already fanned out.
    if (!res.affected) return;
    this.denySidAndDisconnect(session);
  }

  /**
   * End one of a subject's own live sessions. False when the id is unknown,
   * foreign or already dead (callers map that to a 404 or ignore it).
   */
  async revokeById(
    audience: SessionAudience,
    subjectId: number,
    sessionId: string,
    reason: SessionRevokedReason,
  ): Promise<boolean> {
    const session = await this.findLive(audience, subjectId, sessionId);
    if (!session) return false;
    await this.revoke(session, reason);
    return true;
  }

  /**
   * End every live session except `exceptSid` (pass null to spare none) — the
   * password-change semantics: the device that proved the password stays.
   */
  async revokeAllExcept(
    audience: SessionAudience,
    subjectId: number,
    exceptSid: string | null,
    reason: SessionRevokedReason,
  ): Promise<void> {
    const active = await this.listActive(audience, subjectId);
    for (const session of active) {
      if (session.id === exceptSid) continue;
      await this.revoke(session, reason);
    }
  }

  /**
   * Per-request check the JWT strategies and socket gateways run. Fails OPEN
   * on a Redis error: availability over an at-most-one-access-token window,
   * because the refresh path checks the row in Postgres regardless.
   */
  async isRevoked(audience: SessionAudience, sid: string): Promise<boolean> {
    try {
      return (await this.redis.exists(revokedSidKey(audience, sid))) > 0;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifetimes
  // ---------------------------------------------------------------------------

  /** The audience's refresh lifetime in seconds — also the session's TTL. */
  refreshTtlSeconds(audience: SessionAudience): number {
    const [key, fallback] = SESSION_TTL_CONFIG[audience].refresh;
    return parseDurationToSeconds(
      this.config.get<string>(key, fallback),
      parseDurationToSeconds(fallback),
    );
  }

  /** The audience's access-token lifetime in seconds. */
  accessTtlSeconds(audience: SessionAudience): number {
    const [key, fallback] = SESSION_TTL_CONFIG[audience].access;
    return parseDurationToSeconds(
      this.config.get<string>(key, fallback),
      parseDurationToSeconds(fallback),
    );
  }

  /**
   * The two immediate-effect fan-outs of a kill: the per-request Redis
   * denylist and the socket rooms. The denylist entry only has to outlive the
   * access tokens already issued for this session (refresh is checked against
   * the row), so its TTL is one access lifetime plus slack, capped by the
   * session's own expiry. Both best-effort — without them the kill still
   * bites at the next refresh, at most one access-token lifetime away.
   */
  private denySidAndDisconnect(session: AuthSession): void {
    const untilExpiry = Math.ceil(
      (session.expires_at.getTime() - Date.now()) / 1000,
    );
    const ttl = Math.max(
      Math.min(untilExpiry, this.accessTtlSeconds(session.audience) + 60),
      60,
    );
    this.redis
      .set(revokedSidKey(session.audience, session.id), '1', 'EX', ttl)
      .catch((err: Error) =>
        this.logger.error(
          `Failed to denylist session ${session.id}: ${err.message}`,
        ),
      );
    try {
      this.registry.disconnectSession(session.id);
    } catch (err) {
      this.logger.error(
        `Failed to disconnect sockets for session ${session.id}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }
}
