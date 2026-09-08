import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthTokens, AdminService, LoginResult } from './admin.service';
import {
  AllowTotpPending,
  RequireTotpEnrolledGuard,
} from './auth/require-totp-enrolled.guard';
import { GetAdmin } from './auth/get-admin.decorator';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import type { AuthenticatedAdmin } from './auth/jwt.strategy';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DisableTotpDto } from './dto/disable-totp.dto';
import { EnableTotpDto } from './dto/enable-totp.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { VerifyTwoFactorDto } from './dto/verify-two-factor.dto';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Login with email or username + password. Returns tokens immediately, ' +
      'a 2FA challenge if TOTP is already enabled, or tokens with ' +
      'requiresTotpSetup=true if the admin has not yet enrolled.',
  })
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<LoginResult> {
    return this.adminService.login(dto.identifier, dto.password, ip);
  }

  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign in with a Google OIDC ID token. The email must match an existing ' +
      'admin record; new admins are not auto-provisioned. Returns the same ' +
      'shape as POST /admin/login (tokens, 2FA challenge, or totp-pending tokens).',
  })
  loginWithGoogle(
    @Body() dto: GoogleLoginDto,
    @Ip() ip: string,
  ): Promise<LoginResult> {
    return this.adminService.loginWithGoogle(dto.idToken, ip);
  }

  @Post('login/verify-2fa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange a 2FA challenge token + TOTP code (or recovery code) for access/refresh tokens.',
  })
  verifyTwoFactor(
    @Body() dto: VerifyTwoFactorDto,
    @Ip() ip: string,
  ): Promise<AdminAuthTokens> {
    return this.adminService.verifyTwoFactor(dto.challengeToken, dto.code, ip);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new access/refresh pair',
  })
  refresh(@Body() dto: RefreshDto): Promise<AdminAuthTokens> {
    return this.adminService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
  @AllowTotpPending()
  @ApiBearerAuth('admin-access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all refresh tokens for the current admin' })
  async logout(@GetAdmin() admin: AuthenticatedAdmin): Promise<void> {
    await this.adminService.logout(admin.id);
  }

  @UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
  @AllowTotpPending()
  @ApiBearerAuth('admin-access-token')
  @Get('me')
  @ApiOperation({ summary: 'Get the current admin profile' })
  me(@GetAdmin() admin: AuthenticatedAdmin) {
    return this.adminService.getProfile(admin.id);
  }

  @UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
  @ApiBearerAuth('admin-access-token')
  @Patch('me')
  @ApiOperation({
    summary:
      'Update the current admin profile (email, first/last name, mobile). display_name is derived server-side.',
  })
  updateMe(
    @GetAdmin() admin: AuthenticatedAdmin,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.adminService.updateProfile(admin.id, dto);
  }

  @UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
  @ApiBearerAuth('admin-access-token')
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change password (revokes all existing refresh tokens)',
  })
  async changePassword(
    @GetAdmin() admin: AuthenticatedAdmin,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.adminService.changePassword(
      admin.id,
      dto.oldPassword,
      dto.newPassword,
    );
  }

  @UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
  @AllowTotpPending()
  @ApiBearerAuth('admin-access-token')
  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Generate (or rotate) a pending TOTP secret and return otpauth URL + QR data URL.',
  })
  setupTotp(@GetAdmin() admin: AuthenticatedAdmin) {
    return this.adminService.setupTotp(admin.id);
  }

  @UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
  @AllowTotpPending()
  @ApiBearerAuth('admin-access-token')
  @Post('totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify the first TOTP code, persist enrolment, return one-time recovery codes and fresh tokens.',
  })
  enableTotp(
    @GetAdmin() admin: AuthenticatedAdmin,
    @Body() dto: EnableTotpDto,
  ) {
    return this.adminService.enableTotp(admin.id, dto.code);
  }

  @UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
  @ApiBearerAuth('admin-access-token')
  @Post('totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Disable two-factor authentication. Requires the current password and a valid TOTP/recovery code.',
  })
  async disableTotp(
    @GetAdmin() admin: AuthenticatedAdmin,
    @Body() dto: DisableTotpDto,
  ): Promise<void> {
    await this.adminService.disableTotp(admin.id, dto.password, dto.code);
  }
}
