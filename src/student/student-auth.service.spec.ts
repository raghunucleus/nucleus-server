import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { Student } from '../admin/entities/student.entity';
import { AuthSessionsService } from '../auth-sessions/auth-sessions.service';
import {
  DeviceLimitChallenge,
  DeviceLimitChallengeService,
} from '../auth-sessions/device-limit-challenge.service';
import type { DeviceLimitResponse } from '../auth-sessions/device-limit';
import { MailService } from '../mail/mail.service';
import { StorageService } from '../storage/storage.service';
import { StudentGoogleOidcService } from './auth/student-google-oidc.service';
import { StudentCredential } from './entities/student-credential.entity';
import { StudentAuthService } from './student-auth.service';

/**
 * The device-limit completion path of the student login — the mirrored
 * employee/guardian versions share its semantics. Sessions and challenges are
 * mocked; what is under test is the orchestration: account re-checks, own-id
 * revocation, re-running the gate, and when the challenge is consumed.
 */
describe('StudentAuthService.completeDeviceLimitLogin', () => {
  const TOKEN = 'challenge-token';
  let challenge: DeviceLimitChallenge | null;
  let cred: StudentCredential;
  let student: Student;
  let sessions: {
    revokeById: jest.Mock;
    createWithinLimit: jest.Mock;
    accessTtlSeconds: jest.Mock;
    refreshTtlSeconds: jest.Mock;
  };
  let challenges: { peek: jest.Mock; consume: jest.Mock; issue: jest.Mock };
  let service: StudentAuthService;

  const liveSession = { id: 'new-sid' };

  beforeEach(() => {
    challenge = {
      audience: 'student',
      subjectId: 7,
      method: 'password',
      issuedAt: Date.now(),
    };
    student = {
      id: 7,
      student_id: '23A91A0501',
      display_name: 'Test Student',
      email: 't@example.com',
      is_active: true,
    } as Student;
    cred = {
      student_id: 7,
      must_change_password: false,
      password_changed_at: null,
    } as unknown as StudentCredential;

    sessions = {
      revokeById: jest.fn().mockResolvedValue(true),
      createWithinLimit: jest
        .fn()
        .mockResolvedValue({ session: liveSession, refreshJti: 'jti-1' }),
      accessTtlSeconds: jest.fn().mockReturnValue(900),
      refreshTtlSeconds: jest.fn().mockReturnValue(604800),
    };
    challenges = {
      peek: jest.fn(() => Promise.resolve(challenge)),
      consume: jest.fn().mockResolvedValue(undefined),
      issue: jest.fn().mockResolvedValue('fresh-token'),
    };

    service = new StudentAuthService(
      {
        findOne: jest.fn(() => Promise.resolve(student)),
      } as unknown as Repository<Student>,
      {
        findOne: jest.fn(() => Promise.resolve(cred)),
        save: jest.fn((c: StudentCredential) => Promise.resolve(c)),
      } as unknown as Repository<StudentCredential>,
      {
        incr: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
      } as unknown as Redis,
      {
        signAsync: jest.fn((payload: object) =>
          Promise.resolve(JSON.stringify(payload)),
        ),
      } as unknown as JwtService,
      { getOrThrow: () => 'secret' } as unknown as ConfigService,
      {} as MailService,
      {} as StudentGoogleOidcService,
      {} as StorageService,
      sessions as unknown as AuthSessionsService,
      challenges as unknown as DeviceLimitChallengeService,
    );
  });

  const complete = (sessionIds = ['a0000000-0000-4000-8000-000000000001']) =>
    service.completeDeviceLimitLogin(
      { challengeToken: TOKEN, sessionIds, device_id: 'dev-1' },
      { ip: '10.0.0.9', userAgent: 'ua' },
    );

  it('signs the chosen devices out, signs in, then consumes the challenge', async () => {
    const result = await complete();
    expect(sessions.revokeById).toHaveBeenCalledWith(
      'student',
      7,
      'a0000000-0000-4000-8000-000000000001',
      'device_limit',
    );
    expect(sessions.createWithinLimit).toHaveBeenCalledWith(
      'student',
      7,
      2,
      expect.objectContaining({ deviceId: 'dev-1', ip: '10.0.0.9' }),
    );
    expect(challenges.consume).toHaveBeenCalledWith(TOKEN);
    expect(JSON.parse(result.accessToken)).toMatchObject({
      sub: 7,
      sid: 'new-sid',
    });
    expect(JSON.parse(result.refreshToken)).toMatchObject({
      sid: 'new-sid',
      jti: 'jti-1',
    });
  });

  it('treats foreign or dead ids as silent no-ops', async () => {
    sessions.revokeById.mockResolvedValue(false);
    await expect(complete()).resolves.toBeDefined();
  });

  it('keeps the SAME challenge when every slot is taken again', async () => {
    sessions.createWithinLimit.mockResolvedValue({
      limited: true,
      limit: 2,
      active: [
        {
          id: 's1',
          device_name: 'Chrome 130 on Windows',
          created_at: new Date(),
          last_used_at: new Date(),
        },
      ],
    });
    let caught: unknown;
    try {
      await complete();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    const body = (
      caught as ConflictException
    ).getResponse() as DeviceLimitResponse;
    expect(body.code).toBe('DEVICE_LIMIT');
    expect(body.challengeToken).toBe(TOKEN);
    expect(body.sessions).toHaveLength(1);
    expect(challenges.issue).not.toHaveBeenCalled();
    expect(challenges.consume).not.toHaveBeenCalled();
  });

  it('never carries the must-change flag out of a Google login', async () => {
    cred.must_change_password = true;
    challenge!.method = 'google';
    const result = await complete();
    expect(result.mustChangePassword).toBe(false);
    expect(JSON.parse(result.accessToken)).toMatchObject({ mcp: false });
  });

  it('rejects an unknown, foreign-audience or superseded challenge', async () => {
    challenge = null;
    await expect(complete()).rejects.toBeInstanceOf(UnauthorizedException);

    challenge = {
      audience: 'employee',
      subjectId: 7,
      method: 'password',
      issuedAt: Date.now(),
    };
    await expect(complete()).rejects.toBeInstanceOf(UnauthorizedException);

    challenge = {
      audience: 'student',
      subjectId: 7,
      method: 'password',
      issuedAt: Date.now() - 60_000,
    };
    cred.password_changed_at = new Date();
    await expect(complete()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.revokeById).not.toHaveBeenCalled();
  });

  it('rejects a deactivated account', async () => {
    student.is_active = false;
    await expect(complete()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.revokeById).not.toHaveBeenCalled();
  });
});
