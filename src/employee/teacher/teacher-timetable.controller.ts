import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { TeacherHistoryQueryDto } from './dto/teacher-attendance.dto';
import {
  TeacherAttendanceService,
  type TeacherSessionListItem,
} from './teacher-attendance.service';

/**
 * Teacher's week timetable. Reuses the daily/attendance query layer — the
 * underlying class_sessions filter is the same (`effective_employee_id`), so
 * substitute slots show up automatically. Gated by the
 * `timetable.teacher.view` screen so it appears in the "Time table" sidebar
 * group via the dynamic menu.
 */
@ApiTags('teacher-timetable')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/teacher/timetable')
export class TeacherTimetableController {
  constructor(private readonly svc: TeacherAttendanceService) {}

  @Get('week')
  @RequireScreen('timetable.teacher.view', 'view')
  @ApiOperation({
    summary:
      "The signed-in teacher's class sessions across a date window, " +
      'sorted ASC by date — drives the weekly timetable view.',
  })
  week(
    @GetEmployee() employee: AuthenticatedEmployee,
    // Reuse the existing from/to schema — the shape is identical and we
    // don't need a separate week-only DTO.
    @Query() query: TeacherHistoryQueryDto,
  ): Promise<TeacherSessionListItem[]> {
    return this.svc.listWeek(employee.id, query.from, query.to);
  }
}
