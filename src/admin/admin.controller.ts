import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminAuthTokens, AdminService } from './admin.service';
import { GetAdmin } from './auth/get-admin.decorator';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import type { AuthenticatedAdmin } from './auth/jwt.strategy';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email or username + password' })
  login(@Body() dto: LoginDto): Promise<AdminAuthTokens> {
    return this.adminService.login(dto.identifier, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new access/refresh pair',
  })
  refresh(@Body() dto: RefreshDto): Promise<AdminAuthTokens> {
    return this.adminService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('admin-access-token')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all refresh tokens for the current admin' })
  async logout(@GetAdmin() admin: AuthenticatedAdmin): Promise<void> {
    await this.adminService.logout(admin.id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('admin-access-token')
  @Get('me')
  @ApiOperation({ summary: 'Get the current admin profile' })
  me(@GetAdmin() admin: AuthenticatedAdmin) {
    return this.adminService.getProfile(admin.id);
  }

  @UseGuards(JwtAuthGuard)
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
}
