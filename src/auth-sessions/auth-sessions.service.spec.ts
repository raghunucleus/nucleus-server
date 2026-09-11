import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { FindOperator, Repository } from 'typeorm';
import { AuthSession, SessionAudience } from './auth-session.entity';
import { AuthSessionsService } from './auth-sessions.service';
import { SessionSocketRegistry } from './session-socket-registry';
import { ROTATION_GRACE_SECONDS, revokedSidKey } from './session.constants';

/**
 * An in-memory stand-in for the sessions repository — enough of the TypeORM
 * surface (`find`/`findOne`/`save`/`update`/`create`, the transactional
 * `manager`, and the conditional UPDATE builder `rotateOnRefresh` uses) for
 * the service's real logic to run against real rows. The fake UPDATE applies
 * its WHERE and SET in one synchronous step, which is exactly the atomicity
 * Postgres gives the real statement.
 */
function fakeSessionsRepo() {
  const rows: AuthSession[] = [];

  const matches = (row: Record<string, unknown>, where: object): boolean =>
    Object.entries(where).every(([key, cond]) => {
      if (cond instanceof FindOperator) {
        if (cond.type === 'isNull') return row[key] === null;
        if (cond.type === 'moreThan')
          return (row[key] as Date) > (cond.value as Date);
        throw new Error(`Unsupported operator: ${cond.type}`);
      }
      return row[key] === cond;
    });

  const byRecency = (list: AuthSession[]) =>
    [...list].sort(
      (a, b) => b.last_used_at.getTime() - a.last_used_at.getTime(),
    );

  const updateBuilder = () => {
    let patch: Record<string, unknown> = {};
    const params: Record<string, unknown> = {};
    const qb = {
      update: () => qb,
      set: (p: Record<string, unknown>) => {
        patch = p;
        return qb;
      },
      where: (_sql: string, p?: Record<string, unknown>) => {
        Object.assign(params, p);
        return qb;
      },
      andWhere: (_sql: string, p?: Record<string, unknown>) => {
        Object.assign(params, p);
        return qb;
      },
      execute: () => {
        const row = rows.find(
          (r) =>
            r.id === params.sid &&
            r.audience === params.audience &&
            r.refresh_jti === params.jti &&
            r.revoked_at === null &&
            r.expires_at > new Date(),
        );
        if (!row) return Promise.resolve({ affected: 0 });
        const next = { ...patch };
        // SET "prev_refresh_jti" = "refresh_jti" reads the OLD row value.
        if (typeof next.prev_refresh_jti === 'function') {
          next.prev_refresh_jti = row.refresh_jti;
        }
        Object.assign(row, next);
        return Promise.resolve({ affected: 1 });
      },
    };
    return qb;
  };

  const repo = {
    create: (input: Partial<AuthSession>) =>
      ({
        id: input.id ?? randomUUID(),
        device_id: null,
        device_name: 'Unknown device',
        ip: null,
        user_agent: null,
        refresh_jti: null,
        prev_refresh_jti: null,
        rotated_at: null,
        created_at: new Date(),
        last_used_at: new Date(),
        revoked_at: null,
        revoked_reason: null,
        ...input,
      }) as AuthSession,
    save: (entity: AuthSession) => {
      const existing = rows.findIndex((r) => r.id === entity.id);
      if (existing >= 0) rows[existing] = entity;
      else rows.push(entity);
      return Promise.resolve(entity);
    },
    update: (criteria: string | object, patch: Partial<AuthSession>) => {
      const where = typeof criteria === 'string' ? { id: criteria } : criteria;
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, patch));
      return Promise.resolve({ affected: hit.length });
    },
    find: (opts: { where: object }) =>
      Promise.resolve(byRecency(rows.filter((r) => matches(r, opts.where)))),
    findOne: (opts: { where: object }) =>
      Promise.resolve(rows.find((r) => matches(r, opts.where)) ?? null),
    createQueryBuilder: updateBuilder,
    manager: {
      transaction: (cb: (m: unknown) => Promise<unknown>) =>
        cb({
          query: jest.fn().mockResolvedValue([]),
          getRepository: () => repo,
        }),
    },
  };
  return { rows, repo: repo as unknown as Repository<AuthSession> };
}

const fakeRedis = () => {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    store,
    client: {
      set: jest
        .fn()
        .mockImplementation(
          (key: string, value: string, _ex: string, ttl: number) => {
            store.set(key, { value, ttl });
            return Promise.resolve('OK');
          },
        ),
      exists: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(store.has(key) ? 1 : 0),
        ),
    } as unknown as Redis & { set: jest.Mock; exists: jest.Mock },
  };
};

describe('AuthSessionsService', () => {
  let repo: ReturnType<typeof fakeSessionsRepo>;
  let redis: ReturnType<typeof fakeRedis>;
  let registry: { disconnectSession: jest.Mock };
  let service: AuthSessionsService;

  beforeEach(() => {
    repo = fakeSessionsRepo();
    redis = fakeRedis();
    registry = { disconnectSession: jest.fn() };
    service = new AuthSessionsService(
      repo.repo,
      redis.client,
      { get: (_k: string, d: string) => d } as unknown as ConfigService,
      registry as unknown as SessionSocketRegistry,
    );
  });

  const signIn = (
    opts: {
      deviceId?: string;
      limit?: number;
      audience?: SessionAudience;
      subjectId?: number;
    } = {},
  ) =>
    service.createWithinLimit(
      opts.audience ?? 'student',
      opts.subjectId ?? 7,
      opts.limit ?? 2,
      { deviceId: opts.deviceId, ip: '10.0.0.1' },
    );

  const issued = async (opts?: Parameters<typeof signIn>[0]) => {
    const r = await signIn(opts);
    if ('limited' in r) throw new Error('expected a session');
    return r;
  };

  describe('createWithinLimit', () => {
    it('creates sessions up to the limit, then reports the occupants', async () => {
      await issued();
      await issued();
      const third = await signIn();
      expect('limited' in third && third.limited).toBe(true);
      if (!('limited' in third)) return;
      expect(third.limit).toBe(2);
      expect(third.active).toHaveLength(2);
      expect(repo.rows).toHaveLength(2);
    });

    it('honours a raised limit', async () => {
      await issued({ limit: 3 });
      await issued({ limit: 3 });
      const third = await signIn({ limit: 3 });
      expect('limited' in third).toBe(false);
    });

    it('replaces the same device instead of taking a second slot', async () => {
      const first = await issued({ deviceId: 'browser-A' });
      const again = await issued({ deviceId: 'browser-A' });
      expect(again.session.id).not.toBe(first.session.id);

      const old = repo.rows.find((r) => r.id === first.session.id)!;
      expect(old.revoked_reason).toBe('replaced');
      expect(old.refresh_jti).toBeNull();
      // Its outstanding tokens die now.
      expect(redis.store.has(revokedSidKey('student', old.id))).toBe(true);
      expect(registry.disconnectSession).toHaveBeenCalledWith(old.id);

      // Still one live slot used — a second device fits.
      expect('limited' in (await signIn({ deviceId: 'phone-B' }))).toBe(false);
    });

    it('replaces an expired-but-unrevoked row for the same device', async () => {
      const first = await issued({ deviceId: 'browser-A' });
      repo.rows[0].expires_at = new Date(Date.now() - 1000);
      await issued({ deviceId: 'browser-A' });
      expect(
        repo.rows.find((r) => r.id === first.session.id)!.revoked_reason,
      ).toBe('replaced');
    });

    it('does not count expired sessions toward the limit', async () => {
      await issued();
      await issued();
      repo.rows[0].expires_at = new Date(Date.now() - 1000);
      expect('limited' in (await signIn())).toBe(false);
    });

    it('keeps audiences apart for the same subject id', async () => {
      await issued({ audience: 'student' });
      await issued({ audience: 'student' });
      expect('limited' in (await signIn({ audience: 'guardian' }))).toBe(false);
      expect('limited' in (await signIn({ audience: 'employee' }))).toBe(false);
    });

    it('keeps subjects apart within an audience', async () => {
      await issued({ subjectId: 1 });
      await issued({ subjectId: 1 });
      expect('limited' in (await signIn({ subjectId: 2 }))).toBe(false);
    });
  });

  describe('rotateOnRefresh', () => {
    it('rotates the jti on the same session and rolls the expiry forward', async () => {
      const { session, refreshJti } = await issued();
      const row = repo.rows[0];
      row.expires_at = new Date(Date.now() + 1000);

      const next = await service.rotateOnRefresh(
        'student',
        session.id,
        refreshJti,
      );
      expect(next.session.id).toBe(session.id);
      expect(next.refreshJti).not.toBe(refreshJti);
      expect(row.refresh_jti).toBe(next.refreshJti);
      expect(row.prev_refresh_jti).toBe(refreshJti);
      expect(row.expires_at.getTime()).toBeGreaterThan(
        Date.now() + 6 * 86400 * 1000,
      );
    });

    it('re-issues the current jti for the previous one inside the grace window', async () => {
      const { session, refreshJti } = await issued();
      const rotated = await service.rotateOnRefresh(
        'student',
        session.id,
        refreshJti,
      );
      const graced = await service.rotateOnRefresh(
        'student',
        session.id,
        refreshJti,
      );
      expect(graced.refreshJti).toBe(rotated.refreshJti);
      expect(repo.rows[0].revoked_at).toBeNull();
    });

    it('lets exactly one of two concurrent refreshes rotate', async () => {
      const { session, refreshJti } = await issued();
      const [a, b] = await Promise.all([
        service.rotateOnRefresh('student', session.id, refreshJti),
        service.rotateOnRefresh('student', session.id, refreshJti),
      ]);
      // Both callers converge on one refresh token; the session survives.
      expect(a.refreshJti).toBe(b.refreshJti);
      expect(repo.rows[0].refresh_jti).toBe(a.refreshJti);
      expect(repo.rows[0].prev_refresh_jti).toBe(refreshJti);
      expect(repo.rows[0].revoked_at).toBeNull();
    });

    it('burns the session for a rotated-out jti outside the grace window', async () => {
      const { session, refreshJti } = await issued();
      await service.rotateOnRefresh('student', session.id, refreshJti);
      repo.rows[0].rotated_at = new Date(
        Date.now() - (ROTATION_GRACE_SECONDS + 5) * 1000,
      );

      await expect(
        service.rotateOnRefresh('student', session.id, refreshJti),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repo.rows[0].revoked_reason).toBe('reuse_detected');
      expect(registry.disconnectSession).toHaveBeenCalledWith(session.id);
    });

    it('rejects a never-issued jti by burning the session', async () => {
      const { session } = await issued();
      await expect(
        service.rotateOnRefresh('student', session.id, 'forged'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repo.rows[0].revoked_reason).toBe('reuse_detected');
    });

    it('rejects revoked, expired, unknown and wrong-audience sessions', async () => {
      const a = await issued();
      await service.revoke(repo.rows[0], 'user');
      await expect(
        service.rotateOnRefresh('student', a.session.id, a.refreshJti),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const b = await issued();
      repo.rows[1].expires_at = new Date(Date.now() - 1000);
      await expect(
        service.rotateOnRefresh('student', b.session.id, b.refreshJti),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      await expect(
        service.rotateOnRefresh('student', randomUUID(), 'x'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const c = await issued();
      await expect(
        service.rotateOnRefresh('employee', c.session.id, c.refreshJti),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // A wrong-audience probe must not burn the real session.
      expect(repo.rows[2].revoked_at).toBeNull();
    });
  });

  describe('revoke', () => {
    it('denylists the sid for about one access lifetime and drops its sockets', async () => {
      const { session } = await issued();
      await service.revoke(repo.rows[0], 'admin');

      const entry = redis.store.get(revokedSidKey('student', session.id));
      expect(entry).toBeDefined();
      // 15m access token + 60s slack — not the 7d refresh lifetime.
      expect(entry!.ttl).toBe(15 * 60 + 60);
      expect(registry.disconnectSession).toHaveBeenCalledWith(session.id);
      expect(await service.isRevoked('student', session.id)).toBe(true);
      expect(await service.isRevoked('employee', session.id)).toBe(false);
    });

    it('is idempotent', async () => {
      await issued();
      await service.revoke(repo.rows[0], 'user');
      await service.revoke(repo.rows[0], 'admin');
      expect(repo.rows[0].revoked_reason).toBe('user');
      expect(redis.client.set).toHaveBeenCalledTimes(1);
    });

    it('still ends the session when Redis is down', async () => {
      await issued();
      redis.client.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.revoke(repo.rows[0], 'user')).resolves.toBe(
        undefined,
      );
      expect(repo.rows[0].revoked_at).not.toBeNull();
    });

    it('revokeAllExcept spares only the given session', async () => {
      const keep = await issued({ limit: 5 });
      await issued({ limit: 5 });
      await issued({ limit: 5 });
      await service.revokeAllExcept(
        'student',
        7,
        keep.session.id,
        'password_changed',
      );
      const live = repo.rows.filter((r) => r.revoked_at === null);
      expect(live.map((r) => r.id)).toEqual([keep.session.id]);

      await service.revokeAllExcept('student', 7, null, 'password_reset');
      expect(repo.rows.every((r) => r.revoked_at !== null)).toBe(true);
    });

    it('revokeById ignores foreign and dead ids', async () => {
      const mine = await issued({ subjectId: 1 });
      const theirs = await issued({ subjectId: 2 });
      expect(
        await service.revokeById('student', 1, theirs.session.id, 'user'),
      ).toBe(false);
      expect(
        await service.revokeById('student', 1, mine.session.id, 'user'),
      ).toBe(true);
      expect(
        await service.revokeById('student', 1, mine.session.id, 'user'),
      ).toBe(false);
    });
  });

  it('isRevoked fails open when Redis errors', async () => {
    redis.client.exists.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await service.isRevoked('student', randomUUID())).toBe(false);
  });

  it('list marks the calling device and only exposes the IP on request', async () => {
    const a = await issued();
    await issued();
    const mine = await service.list('student', 7, { currentSid: a.session.id });
    expect(mine.filter((r) => r.current).map((r) => r.id)).toEqual([
      a.session.id,
    ]);
    expect(mine.every((r) => !('ip' in r))).toBe(true);

    const admin = await service.list('student', 7, { includeIp: true });
    expect(admin.every((r) => r.ip === '10.0.0.1')).toBe(true);
    expect(admin.every((r) => r.current === false)).toBe(true);
  });
});
