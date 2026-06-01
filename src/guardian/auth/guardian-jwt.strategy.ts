import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { GuardianAccessPayload } from '../guardian-auth.service';

export interface AuthenticatedGuardian {
  /** The login principal — there is no guardian id; the mobile IS the identity. */
  mobile_number: string;
  must_change_password: boolean;
}

/**
 * Passport strategy for guardian (parent) access tokens. The subject is the
 * mobile number, not a row id — guardians have no global identity. Registered
 * under 'guardian-jwt' with its own secret.
 */
@Injectable()
export class GuardianJwtStrategy extends PassportStrategy(
  Strategy,
  'guardian-jwt',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_GUARDIAN_ACCESS_SECRET'),
    });
  }

  validate(payload: GuardianAccessPayload): AuthenticatedGuardian {
    return {
      mobile_number: payload.sub,
      must_change_password: payload.mcp === true,
    };
  }
}
