import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedGuardian } from '../auth/guardian-jwt.strategy';
import { GuardianPortalService } from './guardian-portal.service';

/**
 * Security chokepoint for scoped guardian routes. Confirms the authenticated
 * mobile number is a contact for the `:studentId` route param (and the student
 * is active) before any handler runs.
 */
@Injectable()
export class GuardianLinkGuard implements CanActivate {
  constructor(private readonly portal: GuardianPortalService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      user?: AuthenticatedGuardian;
      params: Record<string, string>;
    }>();

    const guardian = req.user;
    if (!guardian) return false;

    const studentId = Number(req.params.studentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      throw new BadRequestException('Invalid student id');
    }

    await this.portal.assertLinked(guardian.mobile_number, studentId);
    return true;
  }
}
