import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedAdmin } from './jwt.strategy';

const ALLOW_TOTP_PENDING_KEY = 'admin:allowTotpPending';

/**
 * Mark a route or controller as accessible to admins who have authenticated
 * but have not yet completed TOTP enrolment (e.g. /me, /logout, /totp/setup,
 * /totp/enable). Routes without this decorator require a fully enrolled
 * admin when guarded by RequireTotpEnrolledGuard.
 */
export const AllowTotpPending = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_TOTP_PENDING_KEY, true);

@Injectable()
export class RequireTotpEnrolledGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const allow = this.reflector.getAllAndOverride<boolean>(ALLOW_TOTP_PENDING_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (allow) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedAdmin }>();
    if (!req.user) return false;
    if (req.user.totp_pending) {
      throw new ForbiddenException(
        'Two-factor authentication setup is required before accessing this resource.',
      );
    }
    return true;
  }
}
