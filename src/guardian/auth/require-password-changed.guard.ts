import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedGuardian } from './guardian-jwt.strategy';

const ALLOW_PASSWORD_CHANGE_PENDING_KEY =
  'guardian:allowPasswordChangePending';

/**
 * Mark a route (or controller) reachable by a guardian who is still on an
 * admin-issued temporary password — i.e. before the forced password change.
 * Apply to /me, /logout and /change-password. Every other route guarded by
 * GuardianRequirePasswordChangedGuard is blocked until the guardian picks
 * their own password. (Only relevant for the admin set-password fallback;
 * OTP-set passwords never raise the must-change flag.)
 */
export const AllowPasswordChangePending = (): MethodDecorator &
  ClassDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);

@Injectable()
export class GuardianRequirePasswordChangedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const allow = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE_PENDING_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (allow) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedGuardian }>();
    if (!req.user) return false;
    if (req.user.must_change_password) {
      throw new ForbiddenException(
        'You must change your temporary password before continuing.',
      );
    }
    return true;
  }
}
