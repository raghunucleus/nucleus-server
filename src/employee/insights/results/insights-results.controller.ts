import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../../auth/require-password-changed.guard';
import {
  InsightsBacklogsQueryDto,
  InsightsResultsQueryDto,
  InsightsScopeQueryDto,
} from '../dto/insights-query.dto';
import {
  INSIGHTS_SCREEN_KEYS,
  InsightsScopeService,
} from '../insights-scope.service';
import { GPA_BANDS, InsightsResultsService } from './insights-results.service';

const KEY = INSIGHTS_SCREEN_KEYS.results;

/** GET-only; every handler resolves the RBAC scope first. */
@ApiTags('insights')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/insights/results')
export class InsightsResultsController {
  constructor(
    private readonly scope: InsightsScopeService,
    private readonly svc: InsightsResultsService,
  ) {}

  @Get('batches')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Per batch × semester: students with results, pass %, average SGPA, SGPA histogram and backlog-count mix.',
  })
  async batches(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsResultsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return {
      bands: GPA_BANDS,
      rows: scope ? await this.svc.batches(scope, q.semester) : [],
    };
  }

  @Get('subjects')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Per batch × semester × subject: appeared, passed, fail %, first-attempt failures, grade mix.',
  })
  async subjects(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsResultsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return { rows: scope ? await this.svc.subjects(scope, q.semester) : [] };
  }

  @Get('cgpa')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'CGPA distribution, averages and backlog counts per batch, plus the top performers in scope.',
  })
  async cgpa(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsScopeQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return {
      bands: GPA_BANDS,
      ...(scope
        ? await this.svc.cgpa(scope)
        : { by_batch: [], top_performers: [] }),
    };
  }

  @Get('backlogs')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: 'Students carrying at least N current backlogs (risk list).',
  })
  async backlogs(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsBacklogsQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return scope
      ? this.svc.backlogs(scope, q.min_backlogs)
      : { min_backlogs: q.min_backlogs, total: 0, rows: [] };
  }

  @Get('coverage')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Which batch × semester has results uploaded, flagging completed semesters with none.',
  })
  async coverage(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsScopeQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return { rows: scope ? await this.svc.coverage(scope) : [] };
  }

  @Get('attendance-correlation')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Attendance band vs latest SGPA for students with an ongoing semester.',
  })
  async correlation(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsScopeQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return {
      gpa_bands: GPA_BANDS,
      ...(scope
        ? await this.svc.attendanceCorrelation(scope)
        : { bands: [], cells: [], points: [] }),
    };
  }
}
