import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from '../entities/admin.entity';
import type { AuthenticatedAdmin } from './jwt.strategy';

/**
 * Allows the request only when the authenticated admin has is_master_admin=true.
 * Must run after JwtAuthGuard (relies on req.user). Looks up the flag fresh
 * from the DB so a demotion takes effect immediately, not at access-token TTL.
 */
@Injectable()
export class MasterAdminGuard implements CanActivate {
  constructor(
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedAdmin }>();
    if (!req.user) return false;

    const admin = await this.admins.findOne({
      where: { id: req.user.id },
      select: ['id', 'is_master_admin'],
    });
    if (!admin || !admin.is_master_admin) {
      throw new ForbiddenException('Master admin privileges are required.');
    }
    return true;
  }
}
