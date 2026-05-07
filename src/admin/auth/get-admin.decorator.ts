import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedAdmin } from './jwt.strategy';

export const GetAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
