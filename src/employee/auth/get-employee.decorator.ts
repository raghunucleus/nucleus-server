import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedEmployee } from './employee-jwt.strategy';

export const GetEmployee = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedEmployee => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
