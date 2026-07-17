import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedEmployee } from './employee-jwt.strategy';

const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'employee:allowPasswordChangePending';

/**
 * Mark a route (or controller) as reachable by an employee who is still on an
 * admin-issued temporary password — i.e. before they have completed the forced
 * first-login password change. Apply to /me, /logout and /change-password.
 * Every other route guarded by RequireEmployeePasswordChangedGuard is blocked
 * until the employee picks their own password.
 */
export const AllowEmployeePasswordChangePending = (): MethodDecorator &
  ClassDecorator => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);

@Injectable()
export class RequireEmployeePasswordChangedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const allow = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE_PENDING_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (allow) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedEmployee }>();
    if (!req.user) return false;
    if (req.user.must_change_password) {
      throw new ForbiddenException(
        'You must change your temporary password before continuing.',
      );
    }
    return true;
  }
}
