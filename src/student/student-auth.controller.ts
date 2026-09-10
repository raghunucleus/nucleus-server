import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DeviceLimitLoginDto } from '../auth-sessions/dto/device-limit-login.dto';
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
  @ApiResponse({
    status: 409,
    description:
      'Device limit reached (`code: DEVICE_LIMIT`): body carries a ' +
      'challengeToken and the signed-in devices; finish via login/device-limit.',
  })
  login(
    @Body() dto: StudentLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<StudentLoginResult> {
    return this.auth.login(dto.student_id, dto.password, {
      deviceId: dto.device_id,
      deviceName: dto.device_name,
      ip,
      userAgent,
    });
  }

  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign in with a Google ID token. The Google email must match an ' +
      'existing, active student record; students are not auto-created.',
  })
  @ApiResponse({ status: 409, description: 'Device limit reached.' })
  loginWithGoogle(
    @Body() dto: StudentGoogleLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<StudentLoginResult> {
    return this.auth.loginWithGoogle(dto.idToken, {
      deviceId: dto.device_id,
      deviceName: dto.device_name,
      ip,
      userAgent,
    });
  }

  @Post('login/device-limit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Finish a login paused by the device limit: sign the chosen devices ' +
      'out, then sign in here. Still at the limit → 409 again with the SAME ' +
      'challengeToken and a fresh device list.',
  })
  @ApiResponse({ status: 409, description: 'Still at the device limit.' })
  completeDeviceLimitLogin(
    @Body() dto: DeviceLimitLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<StudentLoginResult> {
    return this.auth.completeDeviceLimitLogin(dto, { ip, userAgent });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange a refresh token for a new pair. Refresh tokens are single-use; ' +
      'replaying a rotated token outside the short grace window signs that ' +
      'device out.',
  })
  refresh(
    @Body() dto: StudentRefreshDto,
    @Ip() ip: string,
  ): Promise<StudentAuthTokens> {
    return this.auth.refresh(dto.refreshToken, ip);
  }

  @UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
  @AllowPasswordChangePending()
  @ApiBearerAuth('student-access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out this device. Other signed-in devices are unaffected.',
  })
  async logout(@GetStudent() student: AuthenticatedStudent): Promise<void> {
    await this.auth.logout(student.id, student.sid);
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
      'voluntary changes. Signs out every other device and returns a fresh ' +
      'pair for this one.',
  })
  changePassword(
    @GetStudent() student: AuthenticatedStudent,
    @Body() dto: StudentChangePasswordDto,
  ): Promise<StudentAuthTokens> {
    return this.auth.changePassword(
      student.id,
      student.sid,
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
