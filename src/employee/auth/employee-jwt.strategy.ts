import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { EmployeeAccessPayload } from './employee-auth.service';

export interface AuthenticatedEmployee {
  id: number;
  emp_code: string;
  must_change_password: boolean;
}

/**
 * Passport strategy for employee access tokens. Registered under a distinct
 * name ('employee-jwt') with its own signing secret so an employee token can
 * never be accepted on admin or student routes, and vice versa.
 */
@Injectable()
export class EmployeeJwtStrategy extends PassportStrategy(
  Strategy,
  'employee-jwt',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_EMPLOYEE_ACCESS_SECRET'),
    });
  }

  validate(payload: EmployeeAccessPayload): AuthenticatedEmployee {
    return {
      id: payload.sub,
      emp_code: payload.emp_code,
      must_change_password: payload.mcp === true,
    };
  }
}
