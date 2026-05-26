import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedEmployee } from '../employee/auth/employee-jwt.strategy';
import { PermissionsService } from './permissions.service';
import {
  REQUIRE_SCREEN_METADATA,
  RequireScreenSpec,
} from './require-screen.decorator';

/**
 * Reads `@RequireScreen(...)` metadata and asserts the current authenticated
 * employee has the screen + action via `PermissionsService`. Intended to run
 * AFTER `EmployeeJwtAuthGuard` so `req.user` is populated.
 *
 * Throws ForbiddenException on missing access — never reveals whether the
 * screen exists in the catalog (just "Access denied").
 */
@Injectable()
export class ScreenAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<RequireScreenSpec | undefined>(
      REQUIRE_SCREEN_METADATA,
      [ctx.getHandler(), ctx.getClass()],
    );
    // No @RequireScreen on this handler — let it through.
    if (!spec) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedEmployee }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('Access denied');
    }

    const ok = await this.permissions.hasAction(
      user.id,
      spec.screenKey,
      spec.action,
    );
    if (!ok) {
      throw new ForbiddenException('Access denied');
    }
    return true;
  }
}
