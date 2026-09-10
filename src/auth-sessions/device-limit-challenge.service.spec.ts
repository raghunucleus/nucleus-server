import { Redis } from 'ioredis';
import { DeviceLimitChallengeService } from './device-limit-challenge.service';
import { DEVICE_LIMIT_CHALLENGE_TTL_SECONDS } from './session.constants';

describe('DeviceLimitChallengeService', () => {
  let store: Map<string, { value: string; ttl: number }>;
  let service: DeviceLimitChallengeService;

  beforeEach(() => {
    store = new Map();
    const redis = {
      set: jest.fn((key: string, value: string, _ex: string, ttl: number) => {
        store.set(key, { value, ttl });
        return Promise.resolve('OK');
      }),
      get: jest.fn((key: string) =>
        Promise.resolve(store.get(key)?.value ?? null),
      ),
      del: jest.fn((key: string) => Promise.resolve(store.delete(key) ? 1 : 0)),
    } as unknown as Redis;
    service = new DeviceLimitChallengeService(redis);
  });

  it('round-trips a challenge without storing the raw token', async () => {
    const token = await service.issue({
      audience: 'employee',
      subjectId: 42,
      method: 'google',
    });
    const [key] = [...store.keys()];
    expect(key).not.toContain(token);
    expect(store.get(key)!.ttl).toBe(DEVICE_LIMIT_CHALLENGE_TTL_SECONDS);

    const peeked = await service.peek(token);
    expect(peeked).toMatchObject({
      audience: 'employee',
      subjectId: 42,
      method: 'google',
    });
    expect(typeof peeked!.issuedAt).toBe('number');
    // Peeking does not consume.
    expect(await service.peek(token)).not.toBeNull();
  });

  it('consume removes the challenge', async () => {
    const token = await service.issue({
      audience: 'student',
      subjectId: 1,
      method: 'password',
    });
    await service.consume(token);
    expect(await service.peek(token)).toBeNull();
  });

  it('is superseded by a password set after it was minted', () => {
    const challenge = {
      audience: 'student' as const,
      subjectId: 1,
      method: 'password' as const,
      issuedAt: Date.now(),
    };
    expect(DeviceLimitChallengeService.supersededBy(challenge, null)).toBe(
      false,
    );
    expect(
      DeviceLimitChallengeService.supersededBy(
        challenge,
        new Date(challenge.issuedAt - 60_000),
      ),
    ).toBe(false);
    expect(
      DeviceLimitChallengeService.supersededBy(
        challenge,
        new Date(challenge.issuedAt + 1),
      ),
    ).toBe(true);
  });
});
