import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
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
  TeacherDayQueryDto,
  TeacherHistoryQueryDto,
  TeacherMarkAttendanceDto,
} from './dto/teacher-attendance.dto';
import {
  TeacherAttendanceService,
  type TeacherRosterResult,
  type TeacherSessionListItem,
} from './teacher-attendance.service';

/**
 * Teacher-facing attendance endpoints. Every handler scopes by the JWT's
 * employee id — a teacher can only ever see or mutate sessions where
 * `effective_employee_id` equals them (covers substitutes automatically).
 *
 * Screen mapping:
 *   - GET    /day, /sessions/:id/roster  → 'attendance.entry.daily' view
 *   - POST   /sessions/:id/mark          → 'attendance.entry.daily' update
 *   - GET    /history                    → 'attendance.entry.history' view
 */
@ApiTags('teacher-attendance')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/teacher/attendance')
export class TeacherAttendanceController {
  constructor(private readonly svc: TeacherAttendanceService) {}

  @Get('day')
  @RequireScreen('attendance.entry.daily', 'view')
  @ApiOperation({
    summary:
      "The signed-in teacher's class sessions on a date — used by the marking screen's day list.",
  })
  day(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: TeacherDayQueryDto,
  ): Promise<TeacherSessionListItem[]> {
    return this.svc.listForDay(employee.id, query.date);
  }

  @Get('history')
  @RequireScreen('attendance.entry.history', 'view')
  @ApiOperation({
    summary:
      "The signed-in teacher's previously held sessions in a date window — review only, no editing here.",
  })
  history(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: TeacherHistoryQueryDto,
  ): Promise<TeacherSessionListItem[]> {
    return this.svc.listHistory(employee.id, query.from, query.to);
  }

  @Get('sessions/:id/roster')
  @RequireScreen('attendance.entry.daily', 'view')
  @ApiOperation({
    summary:
      'Live roster for a session the calling teacher is assigned to, along with each student’s existing mark.',
  })
  roster(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) sessionId: number,
  ): Promise<TeacherRosterResult> {
    return this.svc.rosterFor(employee.id, sessionId);
  }

  @Post('sessions/:id/mark')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('attendance.entry.daily', 'update')
  @ApiOperation({
    summary:
      'Mark or amend attendance for one session the calling teacher is assigned to. allow_amend=true required to re-mark a completed session.',
  })
  mark(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) sessionId: number,
    @Body() body: TeacherMarkAttendanceDto,
  ) {
    return this.svc.mark(employee.id, sessionId, body);
  }
}
