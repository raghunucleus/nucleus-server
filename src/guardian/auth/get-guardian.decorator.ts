import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedGuardian } from './guardian-jwt.strategy';

export const GetGuardian = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedGuardian => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
