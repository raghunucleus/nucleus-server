import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowPasswordChangePending } from './auth/require-password-changed.guard';
import { RequirePasswordChangedGuard } from './auth/require-password-changed.guard';
import { GetStudent } from './auth/get-student.decorator';
import { StudentJwtAuthGuard } from './auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from './auth/student-jwt.strategy';
import { StudentChangePasswordDto } from './dto/student-change-password.dto';
import { StudentForgotPasswordDto } from './dto/student-forgot-password.dto';
import { StudentGoogleLoginDto } from './dto/student-google-login.dto';
import { StudentLoginDto } from './dto/student-login.dto';
import { StudentRefreshDto } from './dto/student-refresh.dto';
import { StudentResetPasswordDto } from './dto/student-reset-password.dto';
import {
  StudentAuthService,
  StudentAuthTokens,
  StudentLoginResult,
  StudentProfile,
} from './student-auth.service';

@ApiTags('student-auth')
@Controller('student/auth')
export class StudentAuthController {
  constructor(private readonly auth: StudentAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign in with student ID + password. Returns access/refresh tokens and ' +
      'mustChangePassword=true when the student is still on an admin-issued ' +
      'temporary password.',
  })
  login(
    @Body() dto: StudentLoginDto,
    @Ip() ip: string,
  ): Promise<StudentLoginResult> {
    return this.auth.login(dto.student_id, dto.password, ip);
  }

  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign in with a Google ID token. The Google email must match an ' +
      'existing, active student record; students are not auto-created.',
  })
  loginWithGoogle(
    @Body() dto: StudentGoogleLoginDto,
    @Ip() ip: string,
  ): Promise<StudentLoginResult> {
    return this.auth.loginWithGoogle(dto.idToken, ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange a refresh token for a new pair. Refresh tokens are single-use; ' +
      'replaying a rotated token revokes the whole session family.',
  })
  refresh(@Body() dto: StudentRefreshDto): Promise<StudentAuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
  @AllowPasswordChangePending()
  @ApiBearerAuth('student-access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every session for the current student.' })
  async logout(@GetStudent() student: AuthenticatedStudent): Promise<void> {
    await this.auth.logout(student.id);
  }

  @UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
  @AllowPasswordChangePending()
  @ApiBearerAuth('student-access-token')
  @Get('me')
  @ApiOperation({ summary: 'Get the current student profile.' })
  me(@GetStudent() student: AuthenticatedStudent): Promise<StudentProfile> {
    return this.auth.getProfile(student.id);
  }

  @UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
  @AllowPasswordChangePending()
  @ApiBearerAuth('student-access-token')
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Change password. Used both for the forced first-login change and for ' +
      'voluntary changes. Revokes all other sessions and returns a fresh pair.',
  })
  changePassword(
    @GetStudent() student: AuthenticatedStudent,
    @Body() dto: StudentChangePasswordDto,
  ): Promise<StudentAuthTokens> {
    return this.auth.changePassword(
      student.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Request a password-reset email. Always returns the same response ' +
      'whether or not the identifier matches an account.',
  })
  async forgotPassword(
    @Body() dto: StudentForgotPasswordDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.auth.forgotPassword(dto.identifier, ip);
    return {
      message: 'If an account matches, a password-reset email has been sent.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Set a new password using a token from the reset email. The token is ' +
      'single-use and revokes all existing sessions.',
  })
  async resetPassword(
    @Body() dto: StudentResetPasswordDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.auth.resetPassword(dto.token, dto.newPassword, ip);
    return { message: 'Your password has been updated. You can now sign in.' };
  }
}
