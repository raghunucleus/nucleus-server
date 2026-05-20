import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { StudentAccessPayload } from '../student-auth.service';

export interface AuthenticatedStudent {
  id: number;
  student_id: string;
  must_change_password: boolean;
}

/**
 * Passport strategy for student access tokens. Registered under a distinct
 * name ('student-jwt') with its own signing secret so a student token can
 * never be accepted on an admin route, and vice versa.
 */
@Injectable()
export class StudentJwtStrategy extends PassportStrategy(
  Strategy,
  'student-jwt',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_STUDENT_ACCESS_SECRET'),
    });
  }

  validate(payload: StudentAccessPayload): AuthenticatedStudent {
    return {
      id: payload.sub,
      student_id: payload.student_id,
      must_change_password: payload.mcp === true,
    };
  }
}
