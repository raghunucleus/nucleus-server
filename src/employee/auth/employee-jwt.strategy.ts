import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthSessionsService } from '../../auth-sessions/auth-sessions.service';
import type { EmployeeAccessPayload } from './employee-auth.service';

export interface AuthenticatedEmployee {
  id: number;
  emp_code: string;
  must_change_password: boolean;
  /** The auth session (device) this request belongs to. */
  sid: string;
}

/**
 * Passport strategy for employee access tokens. Registered under a distinct
 * name ('employee-jwt') with its own signing secret so an employee token can
 * never be accepted on admin or student routes, and vice versa.
 *
 * Every token must name its session (`sid`), and a killed session is refused
 * on the very next request via the Redis denylist. Fails open on a Redis
 * error — the refresh path still enforces revocation against Postgres.
 */
@Injectable()
export class EmployeeJwtStrategy extends PassportStrategy(
  Strategy,
  'employee-jwt',
) {
  constructor(
    config: ConfigService,
    private readonly sessions: AuthSessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_EMPLOYEE_ACCESS_SECRET'),
    });
  }

  async validate(
    payload: EmployeeAccessPayload,
  ): Promise<AuthenticatedEmployee> {
    if (
      !payload.sid ||
      (await this.sessions.isRevoked('employee', payload.sid))
    ) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }
    return {
      id: payload.sub,
      emp_code: payload.emp_code,
      must_change_password: payload.mcp === true,
      sid: payload.sid,
    };
  }
}
