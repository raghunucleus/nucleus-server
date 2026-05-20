import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedStudent } from './student-jwt.strategy';

export const GetStudent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedStudent => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
