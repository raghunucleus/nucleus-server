import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import {
  StudentFullProfile,
  StudentFullProfileService,
} from './student-full-profile.service';

/**
 * The acting student's own full profile — server-driven metadata (per-field
 * policy, mandatory, pending, display) pre-filtered to their entry type.
 * Student id from the JWT only.
 */
@ApiTags('student-profile')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/profile')
export class StudentFullProfileController {
  constructor(private readonly profile: StudentFullProfileService) {}

  @Get('me')
  @ApiOperation({
    summary:
      "The caller's full profile: groups/fields filtered to their entry type, " +
      'each with edit policy, mandatory-ness, pending-request lock, value and ' +
      'display text, plus certifications, resume, personal-email state and ' +
      'completeness.',
  })
  me(@GetStudent() s: AuthenticatedStudent): Promise<StudentFullProfile> {
    return this.profile.me(s.id);
  }
}
