import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireAnyScreen } from '../../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../../auth/require-password-changed.guard';
import {
  CreateSavedViewDto,
  UpdateSavedViewDto,
} from '../dto/insights-views.dto';
import { ALL_INSIGHTS_SCREEN_KEYS } from '../insights-scope.service';
import { InsightsViewsService } from './insights-views.service';

const ANY_INSIGHTS = ALL_INSIGHTS_SCREEN_KEYS.map((screenKey) => ({
  screenKey,
  action: 'view',
}));

/**
 * Personal saved views for the Insights screens. The only writes in the
 * insights namespace, and they touch nothing but the caller's own rows —
 * the screen guard only asks "do they hold any insights screen at all";
 * the service pins every query to `req.user.id`.
 */
@ApiTags('insights')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/insights/views')
export class InsightsViewsController {
  constructor(private readonly svc: InsightsViewsService) {}

  @Get()
  @RequireAnyScreen(...ANY_INSIGHTS)
  @ApiOperation({ summary: 'Your saved insights views, pinned first.' })
  list(@GetEmployee() employee: AuthenticatedEmployee) {
    return this.svc.list(employee.id);
  }

  @Post()
  @RequireAnyScreen(...ANY_INSIGHTS)
  @ApiOperation({
    summary:
      'Save the current address of an insights screen under a name. 409 on a duplicate name for the same screen.',
  })
  create(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() dto: CreateSavedViewDto,
  ) {
    return this.svc.create(employee.id, dto);
  }

  @Patch(':id')
  @RequireAnyScreen(...ANY_INSIGHTS)
  @ApiOperation({
    summary: 'Rename, re-pin, reorder or overwrite a saved view.',
  })
  update(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSavedViewDto,
  ) {
    return this.svc.update(employee.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireAnyScreen(...ANY_INSIGHTS)
  @ApiOperation({ summary: 'Delete one of your saved views.' })
  async remove(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.svc.remove(employee.id, id);
  }
}
