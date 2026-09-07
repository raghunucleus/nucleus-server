import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import {
  AnalyticsDailyQueryDto,
  AnalyticsScopeQueryDto,
  AnalyticsSessionsQueryDto,
} from './dto/attendance-analytics.dto';
import {
  AttendanceAnalyticsService,
  type DailyResult,
  type DayDetailResult,
  type OverviewResult,
  type SessionsResult,
  type StudentDetailResult,
  type StudentsResult,
  type SubjectsResult,
  type TeacherRow,
} from './attendance-analytics.service';

export const ATTENDANCE_ANALYTICS_SCREEN_KEY =
  'attendance.incharge.analytics.view';

/**
 * Read-only attendance analytics for an attendance-group incharge.
 *
 * Every handler is GET and every handler carries `@RequireScreen` — the screen
 * guard is a no-op without the decorator. There is deliberately NO write
 * handler on this controller: that is the safety property that lets the screen
 * be granted freely, the same way `corporate_relations.management_view.view`
 * works.
 *
 * Row scope is NOT an RBAC attribute. `requireScope` re-derives it per request
 * from `attendance_group_incharges` and additionally pins the semester to the
 * group's batch, so holding the screen never widens what a caller can read.
 */
@ApiTags('attendance-analytics')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/attendance-analytics')
export class AttendanceAnalyticsController {
  constructor(private readonly svc: AttendanceAnalyticsService) {}

  @Get('scope')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Attendance groups the caller is incharge of, each with the programme semesters of its batch and a default selection. Fills every picker in one call.',
  })
  scope(@GetEmployee() employee: AuthenticatedEmployee) {
    return this.svc.scope(employee.id);
  }

  @Get('overview')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'KPI header, %-band distribution, marking compliance, per-date trend, weekday and period breakdowns, and data-quality warnings for one group.',
  })
  async overview(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: AnalyticsScopeQueryDto,
  ): Promise<OverviewResult> {
    return this.svc.overview(await this.scopeOf(employee, q));
  }

  @Get('students')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      "Every roster student's overall and per-subject attendance, with defaulter flags, absent streaks and how many more sessions clear the threshold.",
  })
  async students(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: AnalyticsScopeQueryDto,
  ): Promise<StudentsResult> {
    return this.svc.students(await this.scopeOf(employee, q));
  }

  @Get('students/:studentId')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      "One student's per-subject figures plus every session they were marked on. The student must be on the group's roster.",
  })
  async studentDetail(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() q: AnalyticsScopeQueryDto,
  ): Promise<StudentDetailResult> {
    return this.svc.studentDetail(await this.scopeOf(employee, q), studentId);
  }

  @Get('subjects')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Per-subject attendance for the group, with the teachers who took it, its marking backlog, band distribution and weakest students.',
  })
  async subjects(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: AnalyticsScopeQueryDto,
  ): Promise<SubjectsResult> {
    return this.svc.subjects(await this.scopeOf(employee, q));
  }

  @Get('teachers')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Per-teacher marking compliance for the group — sessions assigned, marked, and still unmarked after the fact.',
  })
  async teachers(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: AnalyticsScopeQueryDto,
  ): Promise<TeacherRow[]> {
    return this.svc.teachers(await this.scopeOf(employee, q));
  }

  // Declared before `:date` so the static path wins over the param route.
  @Get('daily')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Per-date attendance for the group. Pass matrix=true for the date x student grid (range-capped).',
  })
  async daily(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: AnalyticsDailyQueryDto,
  ): Promise<DailyResult> {
    return this.svc.daily(await this.scopeOf(employee, q), q.matrix === true);
  }

  @Get('daily/:date')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      "One date's sessions with each student's per-session status. The date must fall inside the requested range.",
  })
  async dayDetail(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('date') date: string,
    @Query() q: AnalyticsScopeQueryDto,
  ): Promise<DayDetailResult> {
    return this.svc.dayDetail(await this.scopeOf(employee, q), date);
  }

  @Get('sessions')
  @RequireScreen(ATTENDANCE_ANALYTICS_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Session log for the group including cancelled sessions and past sessions that were never marked.',
  })
  async sessions(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: AnalyticsSessionsQueryDto,
  ): Promise<SessionsResult> {
    return this.svc.sessions(await this.scopeOf(employee, q), {
      subject_id: q.subject_id,
      state: q.state,
    });
  }

  private scopeOf(
    employee: AuthenticatedEmployee,
    q: {
      group_id: number;
      programme_semester_id: number;
      from?: string;
      to?: string;
    },
  ) {
    return this.svc.requireScope(
      employee.id,
      q.group_id,
      q.programme_semester_id,
      q.from,
      q.to,
    );
  }
}
