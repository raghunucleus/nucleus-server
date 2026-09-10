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
import { DeviceLimitLoginDto } from '../../auth-sessions/dto/device-limit-login.dto';
import {
  AllowEmployeePasswordChangePending,
  RequireEmployeePasswordChangedGuard,
} from './require-password-changed.guard';
import { EmployeeJwtAuthGuard } from './employee-jwt-auth.guard';
import { GetEmployee } from './get-employee.decorator';
import type { AuthenticatedEmployee } from './employee-jwt.strategy';
import { EmployeeChangePasswordDto } from './dto/employee-change-password.dto';
import { EmployeeForgotPasswordDto } from './dto/employee-forgot-password.dto';
import { EmployeeGoogleLoginDto } from './dto/employee-google-login.dto';
import { EmployeeLoginDto } from './dto/employee-login.dto';
import { EmployeeRefreshDto } from './dto/employee-refresh.dto';
import { EmployeeResetPasswordDto } from './dto/employee-reset-password.dto';
import {
  EmployeeAuthService,
  EmployeeAuthTokens,
  EmployeeLoginResult,
  EmployeeProfile,
} from './employee-auth.service';

@ApiTags('employee-auth')
@Controller('employee/auth')
export class EmployeeAuthController {
  constructor(private readonly auth: EmployeeAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign in with employee code + password. Returns access/refresh tokens ' +
      'and mustChangePassword=true when the employee is still on an admin-' +
      'issued temporary password.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Device limit reached (`code: DEVICE_LIMIT`): body carries a ' +
      'challengeToken and the signed-in devices; finish via login/device-limit.',
  })
  login(
    @Body() dto: EmployeeLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<EmployeeLoginResult> {
    return this.auth.login(dto.emp_code, dto.password, {
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
      'existing, active employee record; employees are not auto-created.',
  })
  @ApiResponse({ status: 409, description: 'Device limit reached.' })
  loginWithGoogle(
    @Body() dto: EmployeeGoogleLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<EmployeeLoginResult> {
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
  ): Promise<EmployeeLoginResult> {
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
    @Body() dto: EmployeeRefreshDto,
    @Ip() ip: string,
  ): Promise<EmployeeAuthTokens> {
    return this.auth.refresh(dto.refreshToken, ip);
  }

  @UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
  @AllowEmployeePasswordChangePending()
  @ApiBearerAuth('employee-access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out this device. Other signed-in devices are unaffected.',
  })
  async logout(@GetEmployee() employee: AuthenticatedEmployee): Promise<void> {
    await this.auth.logout(employee.id, employee.sid);
  }

  @UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
  @AllowEmployeePasswordChangePending()
  @ApiBearerAuth('employee-access-token')
  @Get('me')
  @ApiOperation({ summary: 'Get the current employee profile.' })
  me(@GetEmployee() employee: AuthenticatedEmployee): Promise<EmployeeProfile> {
    return this.auth.getProfile(employee.id);
  }

  @UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
  @AllowEmployeePasswordChangePending()
  @ApiBearerAuth('employee-access-token')
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Change password. Used both for the forced first-login change and for ' +
      'voluntary changes. Signs out every other device and returns a fresh ' +
      'pair for this one.',
  })
  changePassword(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() dto: EmployeeChangePasswordDto,
  ): Promise<EmployeeAuthTokens> {
    return this.auth.changePassword(
      employee.id,
      employee.sid,
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
    @Body() dto: EmployeeForgotPasswordDto,
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
    @Body() dto: EmployeeResetPasswordDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.auth.resetPassword(dto.token, dto.newPassword, ip);
    return { message: 'Your password has been updated. You can now sign in.' };
  }
}
