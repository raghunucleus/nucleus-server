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
import { CoordinatorDriveQueryDto } from './dto/coordinator-drive-query.dto';
import {
  COORDINATOR_SCREEN_KEY as KEY,
  PlacementCoordinatorDrivesService,
} from './placement-coordinator-drives.service';

/**
 * The Placement Coordinator's drives surface — the RBAC-scoped, READ-ONLY
 * counterpart of `DrivesController`. Deliberately GET-only: a coordinator can
 * see the drives overlapping their assigned programmes/passout years (and only
 * the students within that scope), never mutate them. Analytics is omitted —
 * its aggregates aren't student-scoped yet.
 *
 * Literal routes are declared before `:id` so those segments aren't swallowed
 * by the param route.
 */
@ApiTags('placement-coordinator/drives')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/placement-coordinator/drives')
export class PlacementCoordinatorDrivesController {
  constructor(private readonly svc: PlacementCoordinatorDrivesService) {}

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "Paginated drive list, scoped to the coordinator's programmes/passout years.",
  })
  list(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Query() query: CoordinatorDriveQueryDto,
  ) {
    return this.svc.list(emp.id, query);
  }

  @Get('scope')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: "The coordinator's accessible programmes + passout years.",
  })
  scope(@GetEmployee() emp: AuthenticatedEmployee) {
    return this.svc.scope(emp.id);
  }

  @Get('filter-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: 'Companies / categories / offer types for the list filters.',
  })
  filterOptions() {
    return this.svc.filterOptions();
  }

  @Get(':id')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'One in-scope drive with its designations and attachments (404 outside scope).',
  })
  get(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.get(emp.id, id);
  }

  @Get(':id/eligibility/summary')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: "An in-scope drive's eligibility with ids resolved to labels.",
  })
  eligibilitySummary(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.eligibilitySummary(emp.id, id);
  }

  @Get(':id/students')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The drive's shortlist, limited to students within the coordinator's scope.",
  })
  students(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.students(emp.id, id, {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
      search: search || undefined,
      status:
        status !== undefined && status !== '' ? Number(status) : undefined,
    });
  }

  @Get(':id/students/:studentId/track')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "An in-scope student's audit trail in this drive (404 when the drive " +
      'or student is outside the coordinator scope).',
  })
  studentTrack(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.svc.studentTrack(emp.id, id, studentId);
  }

  @Get(':id/students/:studentId/profile')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "An in-scope student's full profile — registry groups, certifications " +
      'and resume links; government IDs are excluded.',
  })
  studentProfile(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.svc.studentProfile(emp.id, id, studentId);
  }

  @Get(':id/students/:studentId/drive-activity')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "An in-scope student's lifecycle across every OTHER drive, latest " +
      'activity first.',
  })
  studentDriveActivity(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.svc.studentDriveActivity(emp.id, id, studentId);
  }
}
