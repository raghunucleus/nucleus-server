import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AdminAccessPayload } from '../admin.service';

export interface AuthenticatedAdmin {
  id: string;
  username: string;
  email: string;
  totp_pending: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ADMIN_ACCESS_SECRET'),
    });
  }

  validate(payload: AdminAccessPayload): AuthenticatedAdmin {
    return {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
      // Older tokens (issued before the 2FA migration) won't carry this claim.
      // Treat them as fully enrolled so they continue to work until they expire.
      totp_pending: payload.totp_pending === true,
    };
  }
}
