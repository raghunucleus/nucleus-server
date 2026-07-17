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
import { StudentSearchDto } from '../../student-query/dto/student-search.dto';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { GetEmployee } from '../auth/get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { DriveStudentsSearchService } from './drive-students-search.service';

const KEY = 'drive_management.drives.manage';

/**
 * The drive detail page's "Filter" tab — the registry-driven student search
 * mounted under one drive. Everything here is a read over student data, so
 * every route requires only 'view' on the (unscoped) drives screen; the export
 * endpoint hands off to the generic async export framework rather than
 * streaming a file inline.
 */
@ApiTags('drive-management/drive-students')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/drive-management/drives/:driveId/students')
export class DriveStudentsSearchController {
  constructor(private readonly svc: DriveStudentsSearchService) {}

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

  @Get('filter-prefill')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The drive's eligibility criteria translated to filter conditions the " +
      'tab pre-fills (editable by the user).',
  })
  prefill(@Param('driveId', ParseIntPipe) driveId: number) {
    return this.svc.prefill(driveId);
  }

  @Post('search')
  @HttpCode(200)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Run the student search (JSON only — use .../export for files). POST ' +
      'because the filter AST is a body, but semantically a read.',
  })
  search(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: StudentSearchDto,
  ) {
    return this.svc.search(driveId, dto);
  }

  @Post('export')
  @HttpCode(202)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Start an async CSV/XLSX export of the current search. Returns the job ' +
      'id; completion arrives as an in-app notification and the file expires ' +
      'after 24 hours.',
  })
  export(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: StudentSearchDto,
  ) {
    return this.svc.export(e.id, driveId, dto);
  }
}
