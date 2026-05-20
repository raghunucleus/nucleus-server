import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedStudent } from './student-jwt.strategy';

const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'student:allowPasswordChangePending';

/**
 * Mark a route (or controller) as reachable by a student who is still on an
 * admin-issued temporary password — i.e. before they have completed the forced
 * first-login password change. Apply to /me, /logout and /change-password.
 * Every other route guarded by RequirePasswordChangedGuard is blocked until
 * the student picks their own password.
 */
export const AllowPasswordChangePending = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);

@Injectable()
export class RequirePasswordChangedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const allow = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE_PENDING_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (allow) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedStudent }>();
    if (!req.user) return false;
    if (req.user.must_change_password) {
      throw new ForbiddenException(
        'You must change your temporary password before continuing.',
      );
    }
    return true;
  }
}
