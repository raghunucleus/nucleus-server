import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { DriveAnalyticsService } from './drive-analytics.service';

const KEY = 'drive_management.drives.manage';

/**
 * Per-drive placement analytics — the drive detail page's "Analytics" tab.
 *
 * Same institution-wide screen as the rest of the drive surface (`attributes: []`
 * in the catalog), so the screen guard is the whole access check; the read needs
 * only `view`. All aggregation lives in the service.
 */
@ApiTags('drive-management/drives')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/drive-management/drives')
export class DriveAnalyticsController {
  constructor(private readonly svc: DriveAnalyticsService) {}

  @Get(':id/analytics')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: "A drive's funnel, conversion rates and demographic breakdowns.",
  })
  analytics(@Param('id', ParseIntPipe) id: number) {
    return this.svc.analytics(id);
  }
}
