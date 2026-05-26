import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmployeeJwtAuthGuard } from '../../employee/auth/employee-jwt-auth.guard';
import { GetEmployee } from '../../employee/auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../../employee/auth/employee-jwt.strategy';
import {
  AllowEmployeePasswordChangePending,
  RequireEmployeePasswordChangedGuard,
} from '../../employee/auth/require-password-changed.guard';
import {
  EffectiveAccess,
  PermissionsService,
} from '../permissions.service';

@ApiTags('employee-me')
@ApiBearerAuth('employee-access-token')
@UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
@AllowEmployeePasswordChangePending()
@Controller('employee/me')
export class MeAccessController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get('access')
  @ApiOperation({
    summary:
      'Returns the full effective-access payload for the current employee: ' +
      'which modules and screens they can see and the merged attribute values ' +
      'per screen. Drives the dynamic menu and per-screen rendering on web + ' +
      'mobile.',
  })
  getAccess(
    @GetEmployee() employee: AuthenticatedEmployee,
  ): Promise<EffectiveAccess> {
    return this.permissions.getEffectiveAccess(employee.id);
  }
}
