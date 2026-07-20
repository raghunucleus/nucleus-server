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
import {
  ParseNqlDto,
  StudentSearchDto,
} from '../../student-query/dto/student-search.dto';
import { EligibilityExportDto } from './dto/eligibility-export.dto';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { GetEmployee } from '../auth/get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { EligibilityCheckService } from './eligibility-check.service';

const KEY = 'drive_management.eligibility_check.view';

/**
 * The standalone "Eligibility check" screen — the drive Filter tab's student
 * search without a drive. Everything here is a read over student data, so
 * every route requires only 'view' on the (unscoped) screen; the export
 * endpoint hands off to the generic async export framework rather than
 * streaming a file inline.
 */
@ApiTags('drive-management/eligibility-check')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/drive-management/eligibility-check/students')
export class EligibilityCheckController {
  constructor(private readonly svc: EligibilityCheckService) {}

  @Get('search/meta')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'The student attribute registry (employee surface) — everything the ' +
      'filter builder, NQL editor and column picker need.',
  })
  meta() {
    return this.svc.meta();
  }

  @Get('search/options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'id/label options for one fk-kind attribute (`lookup` from meta), ' +
      'optionally narrowed by `q`.',
  })
  options(@Query('lookup') lookup: string, @Query('q') q?: string) {
    return this.svc.options(lookup, q);
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
    return this.svc.parseNql(dto.nql);
  }

  @Post('search')
  @HttpCode(200)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Run the student search (JSON only — use .../export for files). POST ' +
      'because the filter AST is a body, but semantically a read.',
  })
  search(@Body() dto: StudentSearchDto) {
    return this.svc.search(dto);
  }

  @Get('export/columns')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'The pickable export columns for the export dialog — every selectable ' +
      'student attribute, grouped, with the default sheet layout.',
  })
  exportColumns() {
    return this.svc.exportColumns();
  }

  @Post('export')
  @HttpCode(202)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Start an async CSV/XLSX export of the current search. `export_columns` ' +
      'is the sheet layout (order-significant) and is independent of the ' +
      'on-screen `columns`. Returns the job id; completion arrives as an ' +
      'in-app notification and the file expires after 24 hours.',
  })
  export(
    @GetEmployee() e: AuthenticatedEmployee,
    @Body() dto: EligibilityExportDto,
  ) {
    return this.svc.export(e.id, dto);
  }

  // Hover-card detail, one student at a time: both are fetched only when an
  // employee hovers the row's cell, so the list query stays narrow.
  @Get(':studentId/placements')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Every drive the student was Selected in — company, designation and the ' +
      'recorded package. Internships included, flagged by offer type.',
  })
  placements(@Param('studentId', ParseIntPipe) studentId: number) {
    return this.svc.placements(studentId);
  }

  @Get(':studentId/profile')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The student's full profile — the same payload the drive Students tab's " +
      'detail sheet renders. Government IDs excluded.',
  })
  profile(@Param('studentId', ParseIntPipe) studentId: number) {
    return this.svc.profile(studentId);
  }

  @Get(':studentId/academics')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Prior-qualification percentages, UG CGPA and backlog counts for one ' +
      'student — the Academics hover card.',
  })
  academics(@Param('studentId', ParseIntPipe) studentId: number) {
    return this.svc.academics(studentId);
  }
}
