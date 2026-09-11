import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from '../../rbac/permissions.service';
import { RequireAnyScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { InsightsScopeTreeQueryDto } from './dto/insights-query.dto';
import {
  ALL_INSIGHTS_SCREEN_KEYS,
  InsightsScopeService,
} from './insights-scope.service';

/**
 * The scope picker's data. Guarded by "holds ANY insights screen", then pinned
 * to the ONE screen the page names — attributes are stored per screen key, so
 * an admin may give a role different departments on different insights
 * screens and the picker must reflect the screen it is on.
 */
@ApiTags('insights')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/insights')
export class InsightsScopeController {
  constructor(
    private readonly scope: InsightsScopeService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('scope')
  @RequireAnyScreen(
    ...ALL_INSIGHTS_SCREEN_KEYS.map((screenKey) => ({
      screenKey,
      action: 'view',
    })),
  )
  @ApiOperation({
    summary:
      'Departments, programmes, batches and sections the caller may read on the named insights screen, with each batch’s ongoing semester. Fills every scope picker in one call.',
  })
  async tree(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsScopeTreeQueryDto,
  ) {
    if (
      !ALL_INSIGHTS_SCREEN_KEYS.includes(q.screen) ||
      !(await this.permissions.hasScreen(employee.id, q.screen))
    ) {
      throw new ForbiddenException('Access denied');
    }
    return this.scope.tree(employee.id, q.screen);
  }
}
