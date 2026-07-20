import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import {
  ParseNqlDto,
  StudentSearchDto,
} from '../../student-query/dto/student-search.dto';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import {
  NotifyStudentDto,
  SetAllowedForPlacementsDto,
} from './dto/coordinator-student-query.dto';
import { PlacementCoordinatorStudentsAnalyticsService } from './placement-coordinator-students-analytics.service';
import { PlacementCoordinatorStudentsSearchService } from './placement-coordinator-students-search.service';
import {
  COORDINATOR_STUDENTS_SCREEN_KEY as KEY,
  PlacementCoordinatorStudentsService,
} from './placement-coordinator-students.service';

/**
 * The Students tab's allowed / not-allowed bucket switch. Absent (or anything
 * unrecognised) means both buckets — the switch's "All" position.
 */
const parseAllowed = (v?: string): boolean | undefined => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
};

/**
 * The Placement Coordinator's cohort surface — placement readiness for the
 * batches this employee verifies profiles for.
 *
 * The acting employee always comes from the JWT; the batch id in the query is
 * validated against their verifier rows on every single route, so `view` grants
 * nothing beyond the batches they already verify. The one mutation requires the
 * separate `edit` action, leaving room for read-only coordinators.
 */
@ApiTags('placement-coordinator/students')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/placement-coordinator/students')
export class PlacementCoordinatorStudentsController {
  constructor(
    private readonly svc: PlacementCoordinatorStudentsService,
    private readonly searchSvc: PlacementCoordinatorStudentsSearchService,
    private readonly analyticsSvc: PlacementCoordinatorStudentsAnalyticsService,
  ) {}

  @Get('batches')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'The programme × batch pairs this employee is a profile verifier for ' +
      '(the target-students dropdown). Empty when they verify none.',
  })
  batches(@GetEmployee() emp: AuthenticatedEmployee) {
    return this.svc.myBatches(emp.id);
  }

  // --- Student search (the Students tab) -----------------------------------
  //
  // The registry-driven search the drive Filter tab and Eligibility check also
  // use, scoped to one verified batch. `meta` / `options` / `parse-nql` are
  // batch-independent — the attribute registry does not vary by batch — so they
  // need only the screen grant; `search` and `export` take the batch as a query
  // param and resolve it through assertBatch (404 outside the verified set).

  @Get('search/meta')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'The student attribute registry (employee surface) — everything the ' +
      'filter builder, NQL editor and column picker need.',
  })
  meta() {
    return this.searchSvc.meta();
  }

  @Get('search/options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'id/label options for one fk-kind attribute (`lookup` from meta), ' +
      'optionally narrowed by `q`.',
  })
  options(@Query('lookup') lookup: string, @Query('q') q?: string) {
    return this.searchSvc.options(lookup, q);
  }

  @Post('search/parse-nql')
  @HttpCode(200)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Compile an NQL string to the filter AST so the Filters tab can rebuild ' +
      'its visual rows from a query. Syntax errors return 400.',
  })
  parseNql(@Body() dto: ParseNqlDto) {
    return this.searchSvc.parseNql(dto.nql);
  }

  @Post('search')
  @HttpCode(200)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Search within one verified batch (JSON only — use .../export for ' +
      'files). Rows carry the placement flag and profile completion the ' +
      'results table renders inline.',
  })
  search(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Query('programme_admission_year_id', ParseIntPipe) payId: number,
    @Body() dto: StudentSearchDto,
    @Query('allowed') allowed?: string,
  ) {
    return this.searchSvc.search(emp.id, payId, dto, parseAllowed(allowed));
  }

  @Post('export')
  @HttpCode(202)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Start an async CSV/XLSX export of the current in-batch search. Returns ' +
      'the job id; completion arrives as an in-app notification and the file ' +
      'expires after 24 hours.',
  })
  export(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Query('programme_admission_year_id', ParseIntPipe) payId: number,
    @Body() dto: StudentSearchDto,
    @Query('allowed') allowed?: string,
  ) {
    return this.searchSvc.export(emp.id, payId, dto, parseAllowed(allowed));
  }

  @Get('analytics')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Placement-readiness analytics for one verified batch: totals, the ' +
      'completion distribution and what it is missing, academic splits, a ' +
      'section rollup and the most-placed students.',
  })
  analytics(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Query('programme_admission_year_id', ParseIntPipe) payId: number,
  ) {
    return this.analyticsSvc.analytics(emp.id, payId);
  }

  @Get(':studentId/profile')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "An in-batch student's full profile — every registry group (government " +
      'IDs included, since this employee verifies the profile), certifications ' +
      'and resume links, with completion detail.',
  })
  profile(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query('programme_admission_year_id', ParseIntPipe) payId: number,
  ) {
    return this.svc.profile(emp.id, payId, studentId);
  }

  @Patch(':studentId/allowed')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      "Set the department's placement approval for an in-batch student. " +
      "The student's own interest flag is never touched here.",
  })
  setAllowed(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query('programme_admission_year_id', ParseIntPipe) payId: number,
    @Body() body: SetAllowedForPlacementsDto,
  ) {
    return this.svc.setAllowed(emp.id, payId, studentId, body.allowed);
  }

  @Post(':studentId/notify')
  @HttpCode(200)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Ask an in-batch student to update specific profile fields, with a ' +
      'custom message, over the chosen channels (in-app / push / email).',
  })
  notify(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query('programme_admission_year_id', ParseIntPipe) payId: number,
    @Body() body: NotifyStudentDto,
  ) {
    return this.svc.notifyProfileUpdate(emp.id, payId, studentId, body);
  }
}
