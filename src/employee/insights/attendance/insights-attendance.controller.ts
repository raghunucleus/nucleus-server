import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../../auth/require-password-changed.guard';
import { InsightsAttendanceQueryDto } from '../dto/insights-query.dto';
import {
  INSIGHTS_SCREEN_KEYS,
  InsightsScopeService,
} from '../insights-scope.service';
import {
  AttendanceScope,
  InsightsAttendanceService,
} from './insights-attendance.service';

const KEY = INSIGHTS_SCREEN_KEYS.attendance;

/**
 * GET-only. Every handler resolves the caller's RBAC scope first, then the
 * attendance scope (one semester per batch) on top of it; a caller with no
 * batches gets empty payloads, never someone else's.
 */
@ApiTags('insights')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/insights/attendance')
export class InsightsAttendanceController {
  constructor(
    private readonly scope: InsightsScopeService,
    private readonly svc: InsightsAttendanceService,
  ) {}

  @Get('rollup')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Attendance rolled up department → programme → batch → section, with band tallies and marking compliance per row.',
  })
  async rollup(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsAttendanceQueryDto,
  ) {
    const s = await this.scopeOf(employee, q);
    return s ? this.svc.rollup(s) : null;
  }

  @Get('students')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Every student in scope with overall and per-subject attendance, section and batch labels, defaulter flags and projections.',
  })
  async students(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsAttendanceQueryDto,
  ) {
    const s = await this.scopeOf(employee, q);
    return s
      ? this.svc.students(s)
      : { basis: 'rollup', sessions_remaining: 0, rows: [] };
  }

  @Get('students/:studentId')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: "One student's per-subject figures and sessions." })
  async student(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() q: InsightsAttendanceQueryDto,
  ) {
    const s = await this.scopeOf(employee, q);
    if (!s) return null;
    return this.svc.studentDetail(s, studentId);
  }

  @Get('subjects')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Per-subject attendance across the scope with teachers, marking backlog, band mix and weakest students.',
  })
  async subjects(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsAttendanceQueryDto,
  ) {
    const s = await this.scopeOf(employee, q);
    return s ? this.svc.subjects(s) : { basis: 'rollup', rows: [] };
  }

  @Get('faculty')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Per-teacher load and marking compliance across the scope — sessions, marked, overdue, per-week load, class attendance under them.',
  })
  async faculty(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsAttendanceQueryDto,
  ) {
    const s = await this.scopeOf(employee, q);
    return s ? this.svc.faculty(s) : [];
  }

  @Get('overview')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'KPI header, band distribution, compliance, daily trend, weekday and period breakdowns for the whole scope.',
  })
  async overview(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsAttendanceQueryDto,
  ) {
    const s = await this.scopeOf(employee, q);
    return s ? this.svc.overview(s) : null;
  }

  @Get('leaves')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Leave volume per section and leave type, pending leave age, and the students with the most leave days.',
  })
  async leaves(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsAttendanceQueryDto,
  ) {
    const s = await this.scopeOf(employee, q);
    return s ? this.svc.leaves(s) : null;
  }

  private async scopeOf(
    employee: AuthenticatedEmployee,
    q: InsightsAttendanceQueryDto,
  ): Promise<AttendanceScope | null> {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    if (!scope) return null;
    return this.svc.resolve(scope, q);
  }
}
