import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetAdmin } from '../auth/get-admin.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedAdmin } from '../auth/jwt.strategy';
import { MasterAdminGuard } from '../auth/master-admin.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { CreateAdminUserDto } from '../dto/create-admin-user.dto';
import { ListAdminUsersDto } from '../dto/list-admin-users.dto';
import { UpdateAdminUserDto } from '../dto/update-admin-user.dto';
import {
  AdminUsersService,
  ListAdminUsersResult,
  PublicAdmin,
} from './admin-users.service';

@ApiTags('admin-users')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard, MasterAdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({
    summary:
      'List admin users with server-side pagination, search, and sort (master admins only).',
  })
  list(@Query() query: ListAdminUsersDto): Promise<ListAdminUsersResult> {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single admin user by ID (master admins only).',
  })
  getOne(@Param('id') id: string): Promise<PublicAdmin> {
    return this.users.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a new admin user (master admins only). The new admin must set up 2FA on first login.',
  })
  create(@Body() dto: CreateAdminUserDto): Promise<PublicAdmin> {
    return this.users.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update an admin user (master admins only). The is_master_admin flag is not editable via this endpoint — manage it directly in the database.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
  ): Promise<PublicAdmin> {
    return this.users.update(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate an admin user (master admins only).' })
  activate(
    @GetAdmin() acting: AuthenticatedAdmin,
    @Param('id') id: string,
  ): Promise<PublicAdmin> {
    return this.users.setActive(id, acting.id, true);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Deactivate an admin user (master admins only). Cannot deactivate your own account.',
  })
  deactivate(
    @GetAdmin() acting: AuthenticatedAdmin,
    @Param('id') id: string,
  ): Promise<PublicAdmin> {
    return this.users.setActive(id, acting.id, false);
  }
}
