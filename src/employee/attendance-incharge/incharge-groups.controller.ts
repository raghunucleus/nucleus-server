import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireAnyScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import {
  InchargeScheduleService,
  type InchargeGroupSummary,
} from './incharge-schedule.service';

/**
 * Lightweight controller for the incharge surface's group picker. Lives on
 * the `/employee/attendance-incharge` base path; the templates controller is
 * mounted at `…/timetables` and the schedule (live) controller at
 * `…/sessions`, so this URL stays stable for clients.
 *
 * Shared by both incharge screens (templates + schedule), so it accepts
 * either screen's `view` action.
 */
@ApiTags('incharge-groups')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/attendance-incharge')
export class InchargeGroupsController {
  constructor(private readonly svc: InchargeScheduleService) {}

  @Get('groups')
  @RequireAnyScreen(
    { screenKey: 'timetable.incharge.templates.manage', action: 'view' },
    { screenKey: 'timetable.incharge.schedule.manage', action: 'view' },
  )
  @ApiOperation({
    summary:
      'Active attendance groups the calling employee is incharge of. Drives the group picker on both incharge screens.',
  })
  groups(
    @GetEmployee() employee: AuthenticatedEmployee,
  ): Promise<InchargeGroupSummary[]> {
    return this.svc.listGroups(employee.id);
  }
}
