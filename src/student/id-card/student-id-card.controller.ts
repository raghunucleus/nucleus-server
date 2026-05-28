import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
}
