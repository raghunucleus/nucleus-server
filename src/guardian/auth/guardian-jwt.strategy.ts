import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthSessionsService } from '../../auth-sessions/auth-sessions.service';
import type { GuardianAccessPayload } from '../guardian-auth.service';

export interface AuthenticatedGuardian {
  /** The login principal — there is no guardian id; the mobile IS the identity. */
  mobile_number: string;
  must_change_password: boolean;
  /** The auth session (device) this request belongs to. */
  sid: string;
}

/**
 * Passport strategy for guardian (parent) access tokens. The subject is the
 * mobile number, not a row id — guardians have no global identity. Registered
 * under 'guardian-jwt' with its own secret.
 *
 * Every token must name its session (`sid`), and a killed session is refused
 * on the very next request via the Redis denylist. Fails open on a Redis
 * error — the refresh path still enforces revocation against Postgres.
 */
@Injectable()
export class GuardianJwtStrategy extends PassportStrategy(
  Strategy,
  'guardian-jwt',
) {
  constructor(
    config: ConfigService,
    private readonly sessions: AuthSessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_GUARDIAN_ACCESS_SECRET'),
    });
  }

  async validate(
    payload: GuardianAccessPayload,
  ): Promise<AuthenticatedGuardian> {
    if (
      !payload.sid ||
      (await this.sessions.isRevoked('guardian', payload.sid))
    ) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }
    return {
      mobile_number: payload.sub,
      must_change_password: payload.mcp === true,
      sid: payload.sid,
    };
  }
}
