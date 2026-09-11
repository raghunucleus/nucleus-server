import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../../auth/require-password-changed.guard';
import { InsightsPlacementsQueryDto } from '../dto/insights-query.dto';
import {
  INSIGHTS_SCREEN_KEYS,
  InsightsScopeService,
} from '../insights-scope.service';
import { InsightsPlacementsService } from './insights-placements.service';

const KEY = INSIGHTS_SCREEN_KEYS.placements;

/** GET-only; every handler resolves the RBAC scope first. */
@ApiTags('insights')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/insights/placements')
export class InsightsPlacementsController {
  constructor(
    private readonly scope: InsightsScopeService,
    private readonly svc: InsightsPlacementsService,
  ) {}

  @Get('summary')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Per batch: cohort, eligible, placed (% of cohort and of eligible), offers, multi-offer students, CTC average / median / highest, full-time vs internship split.',
  })
  async summary(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsPlacementsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return {
      rows: scope ? await this.svc.summary(scope, q.passout_years) : [],
    };
  }

  @Get('funnel')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Every drive participation of the scope aggregated: imported → invited → accepted → attended → selected, with rates.',
  })
  async funnel(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsPlacementsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return scope
      ? this.svc.funnel(scope, q.passout_years)
      : InsightsPlacementsService.emptyFunnel();
  }

  @Get('companies')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Top recruiting companies for the scope.' })
  async companies(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsPlacementsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return {
      rows: scope ? await this.svc.companies(scope, q.passout_years) : [],
    };
  }

  @Get('trend')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: 'Month-wise selections per passout year, for cumulative lines.',
  })
  async trend(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsPlacementsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return { rows: scope ? await this.svc.trend(scope, q.passout_years) : [] };
  }

  @Get('unplaced')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Eligible students with no selection yet — CGPA, backlogs, drives invited / attended, last activity.',
  })
  async unplaced(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsPlacementsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return scope
      ? this.svc.unplaced(scope, q.passout_years)
      : { total: 0, rows: [] };
  }
}
