import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { CoordinatorDriveQueryDto } from './dto/coordinator-drive-query.dto';
import { ExportDriveStudentsDto } from './dto/export-drive-students.dto';
import {
  COORDINATOR_SCREEN_KEY as KEY,
  PlacementCoordinatorDrivesService,
} from './placement-coordinator-drives.service';

/**
 * The Placement Coordinator's drives surface — the RBAC-scoped, READ-ONLY
 * counterpart of `DrivesController`. Read-only: a coordinator can see the
 * drives overlapping their assigned programmes/passout years (and only the
 * students within that scope), never mutate them. Analytics is omitted — its
 * aggregates aren't student-scoped yet.
 *
 * The single POST (`students/export`) is the one exception to GET-only, and it
 * mutates nothing here either — it queues a read into an export job, POST only
 * because the column list is too big for a query string.
 *
 * Literal routes are declared before `:id` so those segments aren't swallowed
 * by the param route.
 */
/** Parse a CSV of positive ints (`"3,7"`) — undefined when nothing valid. */
const csvInts = (v?: string): number[] | undefined => {
  const ids = (v ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? ids : undefined;
};

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
    @Query('programme_ids') programmeIds?: string,
    @Query('passout_years') passoutYears?: string,
    @Query('entry_type') entryType?: string,
    @Query('all') all?: string,
  ) {
    return this.svc.students(emp.id, id, {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
      search: search || undefined,
      status:
        status !== undefined && status !== '' ? Number(status) : undefined,
      programmeIds: csvInts(programmeIds),
      passoutYears: csvInts(passoutYears),
      entryType:
        entryType === '1' || entryType === '2' ? Number(entryType) : undefined,
      all: all === '1' || all === 'true',
    });
  }

  @Get(':id/students/filter-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Distinct programme / passout-year / entry-type values among the ' +
      "drive's students within the coordinator's scope.",
  })
  studentFilterOptions(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.studentFilterOptions(emp.id, id);
  }

  // `roster/*` mirrors the manage surface's path, where `students/export` is
  // already taken by the Filter tab's search export.
  @Get(':id/students/roster/export/columns')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The pickable export columns — the drive's lifecycle fields plus every " +
      'selectable student attribute, with the default selection.',
  })
  studentExportColumns() {
    return this.svc.studentExportColumns();
  }

  @Post(':id/students/roster/export')
  @HttpCode(200)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "Queue a spreadsheet of the drive's shortlist as currently filtered, " +
      "limited to the coordinator's scope. Returns a job id — poll " +
      '/employee/exports for the file.',
  })
  studentsExport(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExportDriveStudentsDto,
  ) {
    return this.svc.studentsExport(
      emp.id,
      id,
      {
        search: dto.search,
        status: dto.status,
        programmeIds: dto.programme_ids?.length ? dto.programme_ids : undefined,
        passoutYears: dto.passout_years?.length ? dto.passout_years : undefined,
        entryType: dto.entry_type,
      },
      { columns: dto.columns, format: dto.format },
    );
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
