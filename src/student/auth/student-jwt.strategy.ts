import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthSessionsService } from '../../auth-sessions/auth-sessions.service';
import type { StudentAccessPayload } from '../student-auth.service';

export interface AuthenticatedStudent {
  id: number;
  student_id: string;
  must_change_password: boolean;
  /** The auth session (device) this request belongs to. */
  sid: string;
}

/**
 * Passport strategy for student access tokens. Registered under a distinct
 * name ('student-jwt') with its own signing secret so a student token can
 * never be accepted on an admin route, and vice versa.
 *
 * Every token must name its session (`sid`), and a session signed out from
 * another device / by an admin / by the device-limit picker is refused on the
 * very next request via the Redis denylist — not at the token's own expiry.
 * The check fails open on a Redis error (the refresh path still enforces
 * revocation against Postgres).
 */
@Injectable()
export class StudentJwtStrategy extends PassportStrategy(
  Strategy,
  'student-jwt',
) {
  constructor(
    config: ConfigService,
    private readonly sessions: AuthSessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_STUDENT_ACCESS_SECRET'),
    });
  }

  async validate(payload: StudentAccessPayload): Promise<AuthenticatedStudent> {
    if (
      !payload.sid ||
      (await this.sessions.isRevoked('student', payload.sid))
    ) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }
    return {
      id: payload.sub,
      student_id: payload.student_id,
      must_change_password: payload.mcp === true,
      sid: payload.sid,
    };
  }
}
