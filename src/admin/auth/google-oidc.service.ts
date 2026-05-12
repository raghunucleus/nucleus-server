import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  hostedDomain: string | null;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
}

@Injectable()
export class GoogleOidcService {
  private readonly logger = new Logger(GoogleOidcService.name);
  private clientCache: OAuth2Client | null = null;

  constructor(private readonly config: ConfigService) { }

  // Verifies a Google ID token (issued to the admin web client) and returns
  // the validated identity. Throws UnauthorizedException for any failure
  // mode — never leaks why, to avoid giving attackers a probing oracle.
  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (!idToken || typeof idToken !== 'string') {
      throw new UnauthorizedException('Invalid Google credential');
    }

    const clientId = this.config.get<string>('GOOGLE_ADMIN_OIDC_CLIENT_ID');
    if (!clientId) {
      this.logger.error('GOOGLE_ADMIN_OIDC_CLIENT_ID is not configured');
      throw new InternalServerErrorException(
        'Google sign-in is not configured on this server',
      );
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.getClient(clientId).verifyIdToken({
        idToken,
        audience: clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      this.logger.warn(
        `Google ID token verification failed: ${(err as Error).message}`,
      );
      throw new UnauthorizedException('Invalid Google credential');
    }
    console.log({ payload })
    if (!payload) throw new UnauthorizedException('Invalid Google credential');
    if (!payload.email) throw new UnauthorizedException('Invalid Google credential');

    const allowedDomains = this.parseAllowedDomains();
    if (allowedDomains.length > 0) {
      const domain = (payload.hd ?? this.domainOf(payload.email)).toLowerCase();
      if (!allowedDomains.includes(domain)) {
        this.logger.warn(
          `Rejected Google sign-in: domain="${domain}" hd="${payload.hd ?? ''}" email="${payload.email}" allowlist=[${allowedDomains.join(',')}]`,
        );
        throw new UnauthorizedException(
          'This Google account is not allowed to access the admin panel',
        );
      }
    }

    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      hostedDomain: payload.hd ?? null,
      name: payload.name ?? null,
      givenName: payload.given_name ?? null,
      familyName: payload.family_name ?? null,
    };
  }

  private getClient(clientId: string): OAuth2Client {
    if (!this.clientCache) {
      this.clientCache = new OAuth2Client(clientId);
    }
    return this.clientCache;
  }

  private parseAllowedDomains(): string[] {
    const raw = this.config.get<string>('GOOGLE_ADMIN_ALLOWED_DOMAINS') ?? '';
    return raw
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);
  }

  private domainOf(email: string): string {
    const at = email.lastIndexOf('@');
    return at >= 0 ? email.slice(at + 1) : '';
  }
}
