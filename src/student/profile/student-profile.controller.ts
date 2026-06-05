import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { UpdateProfilePrivacyDto } from './dto/profile-privacy.dto';
import {
  ProfilePrivacy,
  StudentProfileService,
} from './student-profile.service';

/**
 * The acting student's own profile-privacy settings — which personal fields are
 * hidden from peers (the classmate profile shown in chat). The student id comes
 * only from the JWT (`@GetStudent()`); a student can only read/change their own.
 */
@ApiTags('student-profile')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/profile/privacy')
export class StudentProfileController {
  constructor(private readonly profile: StudentProfileService) {}

  @Get()
  @ApiOperation({
    summary:
      "The caller's hidden personal profile fields (peers can't see these). " +
      'Empty list means everything is visible.',
  })
  getPrivacy(@GetStudent() s: AuthenticatedStudent): Promise<ProfilePrivacy> {
    return this.profile.getPrivacy(s.id);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Replace the set of hidden personal profile fields. Only hidden keys are ' +
      'stored; omit a field to make it visible again. Hiding `birthday` also ' +
      "removes the caller from classmates' birthday lists.",
  })
  updatePrivacy(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: UpdateProfilePrivacyDto,
  ): Promise<ProfilePrivacy> {
    return this.profile.updatePrivacy(s.id, dto.hidden);
  }
}
