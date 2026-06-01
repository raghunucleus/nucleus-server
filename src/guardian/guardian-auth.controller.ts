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
import { GetGuardian } from './auth/get-guardian.decorator';
import { GuardianJwtAuthGuard } from './auth/guardian-jwt-auth.guard';
import type { AuthenticatedGuardian } from './auth/guardian-jwt.strategy';
import {
  AllowPasswordChangePending,
  GuardianRequirePasswordChangedGuard,
} from './auth/require-password-changed.guard';
import { GuardianChangePasswordDto } from './dto/guardian-change-password.dto';
import { GuardianLoginDto } from './dto/guardian-login.dto';
import { GuardianRefreshDto } from './dto/guardian-refresh.dto';
import { GuardianRequestOtpDto } from './dto/guardian-request-otp.dto';
import { GuardianVerifyOtpDto } from './dto/guardian-verify-otp.dto';
import {
  GuardianAuthService,
  GuardianAuthTokens,
  GuardianLoginResult,
  GuardianProfile,
} from './guardian-auth.service';

@ApiTags('guardian-auth')
@Controller('guardian/auth')
export class GuardianAuthController {
  constructor(private readonly auth: GuardianAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign in with mobile number + password. Returns tokens and the list of ' +
      'linked students so the app can show the child selector immediately.',
  })
  login(
    @Body() dto: GuardianLoginDto,
    @Ip() ip: string,
  ): Promise<GuardianLoginResult> {
    return this.auth.login(dto.mobile_number, dto.password, ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange a refresh token for a new pair. Single-use; replaying a ' +
      'rotated token revokes the whole session family.',
  })
  refresh(@Body() dto: GuardianRefreshDto): Promise<GuardianAuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Request a one-time code to set/reset the password. Always returns the ' +
      'same response whether or not the mobile matches an account.',
  })
  async requestOtp(
    @Body() dto: GuardianRequestOtpDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.auth.requestOtp(dto.mobile_number, dto.channel, ip);
    return {
      message: 'If an account matches, a verification code has been sent.',
    };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify a one-time code and set a new password. The code is single-use ' +
      'and revokes all existing sessions.',
  })
  async verifyOtp(
    @Body() dto: GuardianVerifyOtpDto,
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    await this.auth.verifyOtpAndSetPassword(
      dto.mobile_number,
      dto.otp,
      dto.newPassword,
      ip,
    );
    return { message: 'Your password has been set. You can now sign in.' };
  }

  @UseGuards(GuardianJwtAuthGuard, GuardianRequirePasswordChangedGuard)
  @AllowPasswordChangePending()
  @ApiBearerAuth('guardian-access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every session for the current guardian.' })
  async logout(@GetGuardian() guardian: AuthenticatedGuardian): Promise<void> {
    await this.auth.logout(guardian.mobile_number);
  }

  @UseGuards(GuardianJwtAuthGuard, GuardianRequirePasswordChangedGuard)
  @AllowPasswordChangePending()
  @ApiBearerAuth('guardian-access-token')
  @Get('me')
  @ApiOperation({
    summary: 'Current guardian profile, including the linked students.',
  })
  me(@GetGuardian() guardian: AuthenticatedGuardian): Promise<GuardianProfile> {
    return this.auth.getProfile(guardian.mobile_number);
  }

  @UseGuards(GuardianJwtAuthGuard, GuardianRequirePasswordChangedGuard)
  @AllowPasswordChangePending()
  @ApiBearerAuth('guardian-access-token')
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Change password. Revokes all other sessions and returns a fresh pair.',
  })
  changePassword(
    @GetGuardian() guardian: AuthenticatedGuardian,
    @Body() dto: GuardianChangePasswordDto,
  ): Promise<GuardianAuthTokens> {
    return this.auth.changePassword(
      guardian.mobile_number,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
