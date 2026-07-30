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
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { CrViewListQueryDto } from './dto/cr-view.dto';
import { ManagementViewService } from './management-view.service';

const KEY = 'corporate_relations.management_view.view';

/**
 * Management View — the whole CR desk for one passout year: every company, every
 * job role, every CR.
 *
 * The unscoped counterpart to {@link CrViewController}. That controller's
 * handlers all take `@GetEmployee()` and filter by it; **none of these do, on
 * purpose** — the acting employee is irrelevant to what this screen may see. The
 * access check is entirely the screen guard, exactly as on Company Management
 * ("unscoped — every company is visible to anyone holding the screen").
 *
 * Its own class with its own `KEY`, per the one-screen-key-per-controller rule:
 * pairing an unscoped key with CR View's self-scoped handlers in a single class
 * is precisely the shape the RBAC contract warns about, and the failure would be
 * a silent cross-CR leak.
 *
 * **GET only.** There is deliberately no write handler and no `edit` action in
 * the catalog entry, so this key cannot mutate a record its holder does not own.
 * Anything that changes a record belongs on CR View, which is self-scoped.
 */
@ApiTags('corporate-relations/management-view')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/corporate-relations/management-view')
export class ManagementViewController {
  constructor(private readonly svc: ManagementViewService) {}

  @Get('scope')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "CR View's scope (active passout years, which one to open on, and the relationship-type / current-status / designation / programme / job-location pickers with the default status) plus `crs` — every employee accountable for at least one job role, for the CR filter.",
  })
  scope() {
    return this.svc.scope();
  }

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Every company job role with what was recorded for the given passout year, each carrying its responsible CR. `record: null` means nothing has been saved for that year yet. Unpaginated — the client filters, sorts, groups and pages in memory, which is what keeps the insight charts and the table in exact agreement.',
  })
  list(@Query() query: CrViewListQueryDto) {
    return this.svc.list(query);
  }

  @Get('records/:jobRoleId/:passoutYearId/status-history')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'The status transitions of one (job role × passout year), newest first, for ANY job role. `status: null` marks a clear back to the master default. Empty when nothing has been recorded for the year.',
  })
  statusHistory(
    @Param('jobRoleId', ParseIntPipe) jobRoleId: number,
    @Param('passoutYearId', ParseIntPipe) passoutYearId: number,
  ) {
    return this.svc.statusHistory(jobRoleId, passoutYearId);
  }

  @Get('activity')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The year's status-change trend — the last 12 months of transitions (zero-filled) and the CRs who made the most of them. The one insight that cannot be derived from the list, since the list carries only each record's current state.",
  })
  activity(@Query() query: CrViewListQueryDto) {
    return this.svc.activity(query.passout_year_id);
  }
}
