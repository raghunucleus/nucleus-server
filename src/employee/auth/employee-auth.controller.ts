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
  login(
    @Body() dto: EmployeeLoginDto,
    @Ip() ip: string,
  ): Promise<EmployeeLoginResult> {
    return this.auth.login(dto.emp_code, dto.password, ip);
  }

  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign in with a Google ID token. The Google email must match an ' +
      'existing, active employee record; employees are not auto-created.',
  })
  loginWithGoogle(
    @Body() dto: EmployeeGoogleLoginDto,
    @Ip() ip: string,
  ): Promise<EmployeeLoginResult> {
    return this.auth.loginWithGoogle(dto.idToken, ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange a refresh token for a new pair. Refresh tokens are single-use; ' +
      'replaying a rotated token revokes the whole session family.',
  })
  refresh(@Body() dto: EmployeeRefreshDto): Promise<EmployeeAuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
  @AllowEmployeePasswordChangePending()
  @ApiBearerAuth('employee-access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every session for the current employee.' })
  async logout(@GetEmployee() employee: AuthenticatedEmployee): Promise<void> {
    await this.auth.logout(employee.id);
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
      'voluntary changes. Revokes all other sessions and returns a fresh pair.',
  })
  changePassword(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() dto: EmployeeChangePasswordDto,
  ): Promise<EmployeeAuthTokens> {
    return this.auth.changePassword(
      employee.id,
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
      message:
        'If an account matches, a password-reset email has been sent.',
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
