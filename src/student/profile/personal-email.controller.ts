import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import {
  RequestPersonalEmailOtpDto,
  VerifyPersonalEmailOtpDto,
} from './dto/personal-email.dto';
import { PersonalEmailService } from './personal-email.service';

/**
 * OTP-verified personal email (the OTP_VERIFY edit policy — no approver;
 * proving inbox control is the gate). Student id from the JWT only.
 */
@ApiTags('student-profile')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/profile/personal-email')
export class PersonalEmailController {
  constructor(private readonly personalEmail: PersonalEmailService) {}

  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Stage a new personal email and send a 6-digit code to it. Re-requesting ' +
      'invalidates earlier codes.',
  })
  requestOtp(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: RequestPersonalEmailOtpDto,
  ) {
    return this.personalEmail.requestOtp(s.id, dto.email);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify the code sent to the staged address; on success it becomes the ' +
      'profile personal email.',
  })
  verifyOtp(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: VerifyPersonalEmailOtpDto,
  ) {
    return this.personalEmail.verifyOtp(s.id, dto.code);
  }

  @Delete('pending')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Abandon the staged (unverified) address.' })
  cancelPending(@GetStudent() s: AuthenticatedStudent) {
    return this.personalEmail.cancelPending(s.id);
  }
}
