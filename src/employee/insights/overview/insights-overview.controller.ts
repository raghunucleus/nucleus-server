import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../../auth/require-password-changed.guard';
import { InsightsOverviewQueryDto } from '../dto/insights-query.dto';
import { INSIGHTS_SCREEN_KEYS } from '../insights-scope.service';
import { InsightsOverviewService } from './insights-overview.service';

const KEY = INSIGHTS_SCREEN_KEYS.overview;

/** GET-only. Domain blocks are computed only for screens the caller also holds. */
@ApiTags('insights')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/insights/overview')
export class InsightsOverviewController {
  constructor(private readonly svc: InsightsOverviewService) {}

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'KPI strip across attendance, results, placements and requests with period-over-period deltas (`window` = 7 | 30 | 90 days); department comparison when the scope spans several; attention feed; weekly attendance and monthly placement trends. Cached five minutes.',
  })
  overview(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsOverviewQueryDto,
  ) {
    return this.svc.overview(employee.id, q);
  }
}
