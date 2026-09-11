import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../../auth/require-password-changed.guard';
import { InsightsRequestsQueryDto } from '../dto/insights-query.dto';
import {
  INSIGHTS_SCREEN_KEYS,
  InsightsScopeService,
} from '../insights-scope.service';
import { InsightsRequestsService } from './insights-requests.service';

const KEY = INSIGHTS_SCREEN_KEYS.requests;

/** GET-only; every handler resolves the RBAC scope first. */
@ApiTags('insights')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/insights/requests')
export class InsightsRequestsController {
  constructor(
    private readonly scope: InsightsScopeService,
    private readonly svc: InsightsRequestsService,
  ) {}

  @Get('summary')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Pending backlog by type and age, decision turnaround per type, approver backlog, and the monthly raised-vs-decided trend for the window (default: last 90 days).',
  })
  async summary(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsRequestsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    if (!scope) {
      return {
        window: null,
        pending: [],
        turnaround: [],
        approvers: [],
        trend: [],
      };
    }
    const w = this.svc.window(scope, q.from, q.to);
    const [pending, turnaround, approvers, trend] = await Promise.all([
      this.svc.pending(scope),
      this.svc.turnaround(scope, w),
      this.svc.approvers(scope, w),
      this.svc.trend(scope, w),
    ]);
    return { window: w, pending, turnaround, approvers, trend };
  }

  @Get('leaves')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Leave volume per batch / section / leave type / month in the window, with the approval rate.',
  })
  async leaves(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsRequestsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    if (!scope) return { window: null, rows: [], approval_rate: 0 };
    const w = this.svc.window(scope, q.from, q.to);
    return { window: w, ...(await this.svc.leaves(scope, w)) };
  }
}
