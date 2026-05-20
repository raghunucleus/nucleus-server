import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';

export interface VerifiedStudentGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Verifies Google ID tokens for the student portal. Kept separate from the
 * admin GoogleOidcService so the two auth realms stay independent — they can
 * use different OAuth clients and evolve their own policies.
 *
 * Client id resolution falls back to the admin client id, so a deployment
 * that runs a single Google OAuth client for everything works without extra
 * configuration.
 */
@Injectable()
export class StudentGoogleOidcService {
  private readonly logger = new Logger(StudentGoogleOidcService.name);
  private clientCache: OAuth2Client | null = null;

  constructor(private readonly config: ConfigService) {}

  async verifyIdToken(idToken: string): Promise<VerifiedStudentGoogleIdentity> {
    if (!idToken || typeof idToken !== 'string') {
      throw new UnauthorizedException('Invalid Google credential');
    }

    // Comma-separated so a single OAuth project can list its web + Android +
    // iOS client ids — the mobile app's ID token may be issued to any of them.
    const raw =
      this.config.get<string>('GOOGLE_STUDENT_OIDC_CLIENT_ID') ??
      this.config.get<string>('GOOGLE_ADMIN_OIDC_CLIENT_ID');
    const clientIds = (raw ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (clientIds.length === 0) {
      this.logger.error(
        'Neither GOOGLE_STUDENT_OIDC_CLIENT_ID nor GOOGLE_ADMIN_OIDC_CLIENT_ID is configured',
      );
      throw new InternalServerErrorException(
        'Google sign-in is not configured on this server',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.getClient(clientIds[0]).verifyIdToken({
        idToken,
        audience: clientIds,
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.logger.warn(
        `Student Google ID token verification failed: ${(err as Error).message}`,
      );
      throw new UnauthorizedException('Invalid Google credential');
    }

    if (!payload || !payload.email) {
      throw new UnauthorizedException('Invalid Google credential');
    }

    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
    };
  }

  private getClient(clientId: string): OAuth2Client {
    if (!this.clientCache) {
      this.clientCache = new OAuth2Client(clientId);
    }
    return this.clientCache;
  }
}
