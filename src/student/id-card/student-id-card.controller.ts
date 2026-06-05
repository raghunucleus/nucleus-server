import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SecurityPassResponse } from '../../common/security-pass';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { IdCardResult, StudentIdCardService } from './student-id-card.service';

@ApiTags('student-id-card')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/id-card')
export class StudentIdCardController {
  constructor(private readonly idCard: StudentIdCardService) {}

  @Get()
  @ApiOperation({
    summary:
      "The signed-in student's digital ID card: identity + academic details, " +
      'institution branding, a short-lived presigned photo URL, and a signed ' +
      'QR token. Always scoped to the caller — there is no id parameter.',
  })
  getCard(@GetStudent() student: AuthenticatedStudent): Promise<IdCardResult> {
    return this.idCard.getCard(student.id);
  }

  @Get('pass')
  @ApiOperation({
    summary:
      'Issue a fresh single-use security pass (QR token) for the signed-in ' +
      'student. Lightweight endpoint the client polls to rotate the QR on ' +
      'expiry without re-fetching the whole card. Scoped to the caller.',
  })
  getPass(
    @GetStudent() student: AuthenticatedStudent,
  ): Promise<SecurityPassResponse> {
    return this.idCard.issuePass(student.id);
  }
}
