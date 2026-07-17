import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { DriveAttributesService } from './drive-attributes.service';
import {
  DriveLookupDto,
  DriveLookupStatusDto,
  UpdateDriveLookupDto,
} from './dto/attribute.dto';

const KEY = 'drive_management.drive_attributes.manage';

/**
 * Configure the drive classifier lookups (designations, job-locations,
 * offer-types). `:type` is validated against the whitelist inside the service.
 * The screen has no per-attribute scope, so the screen guard is the whole
 * access check.
 */
@ApiTags('drive-management/attributes')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/drive-management/attributes')
export class DriveAttributesController {
  constructor(private readonly svc: DriveAttributesService) {}

  @Get(':type')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary: 'All values (active + inactive) for a lookup type.',
  })
  list(@Param('type') type: string) {
    return this.svc.list(type, true);
  }

  @Post(':type')
  @RequireScreen(KEY, 'create')
  @ApiOperation({ summary: 'Add a lookup value.' })
  create(@Param('type') type: string, @Body() dto: DriveLookupDto) {
    return this.svc.create(type, dto);
  }

  @Patch(':type/:id')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({ summary: 'Rename / reorder / reflag a lookup value.' })
  update(
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDriveLookupDto,
  ) {
    return this.svc.update(type, id, dto);
  }

  @Patch(':type/:id/status')
  @RequireScreen(KEY, 'activate')
  @ApiOperation({ summary: 'Activate / deactivate a lookup value.' })
  setStatus(
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DriveLookupStatusDto,
  ) {
    return this.svc.setStatus(type, id, dto.is_active);
  }
}
