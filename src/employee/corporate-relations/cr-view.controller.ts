import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { CrViewService } from './cr-view.service';
import { CrViewListQueryDto, UpsertCrViewRecordDto } from './dto/cr-view.dto';

const KEY = 'corporate_relations.cr_view.view';

/**
 * CR View — the job roles the CALLER is accountable for, PER PASSOUT YEAR.
 *
 * Same self-scoping as Roles or Designations (the list filters on
 * `responsible_employee_id = <token employee>`, never a parameter), with a
 * mandatory year axis: the screen's selector cannot be cleared, so
 * `passout_year_id` is required on the list and part of the path on the record
 * routes.
 *
 * A separate controller rather than more handlers on {@link JobRolesController}:
 * that class pins a single module-scope `KEY` and every handler reads against
 * it, which is what makes its guard obvious at a glance. Two screen keys in one
 * class is precisely the shape the RBAC contract warns about — the failure mode
 * is silent, so the guard has to stay greppable.
 */
@ApiTags('corporate-relations/cr-view')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/corporate-relations/cr-view')
export class CrViewController {
  constructor(private readonly svc: CrViewService) {}

  @Get('scope')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The active passout years and which one to open on, plus the relationship-type and current-status pickers and the default status a record shows before anything is recorded — this screen's own lookup source, so it never needs the Company Attributes-guarded master endpoints.",
  })
  scope() {
    return this.svc.scope();
  }

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The job roles the caller is accountable for, each with what was recorded for the given passout year. `record: null` means nothing has been saved for that year yet. Unpaginated — bounded to the caller's own roles.",
  })
  list(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Query() query: CrViewListQueryDto,
  ) {
    return this.svc.list(emp.id, query);
  }

  @Get('records/:jobRoleId/:passoutYearId')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'One (job role × passout year) row — what an editor loads. 404s for a role the caller is not the responsible person for, and for an inactive year.',
  })
  get(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('jobRoleId', ParseIntPipe) jobRoleId: number,
    @Param('passoutYearId', ParseIntPipe) passoutYearId: number,
  ) {
    return this.svc.getRow(emp.id, jobRoleId, passoutYearId);
  }

  @Get('records/:jobRoleId/:passoutYearId/status-history')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'The status transitions of one (job role × passout year), newest first. `status: null` marks a clear back to the master default. Empty when nothing has been recorded for the year.',
  })
  statusHistory(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('jobRoleId', ParseIntPipe) jobRoleId: number,
    @Param('passoutYearId', ParseIntPipe) passoutYearId: number,
  ) {
    return this.svc.statusHistory(emp.id, jobRoleId, passoutYearId);
  }

  @Patch('records/:jobRoleId/:passoutYearId')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Save the record for one (job role × passout year), creating it on first save. PATCH semantics — an absent key leaves that field alone. `current_status_id: null` clears the status, which returns the row to showing the master default.',
  })
  upsert(
    @GetEmployee() emp: AuthenticatedEmployee,
    @Param('jobRoleId', ParseIntPipe) jobRoleId: number,
    @Param('passoutYearId', ParseIntPipe) passoutYearId: number,
    @Body() dto: UpsertCrViewRecordDto,
  ) {
    return this.svc.upsert(emp.id, jobRoleId, passoutYearId, dto);
  }
}
