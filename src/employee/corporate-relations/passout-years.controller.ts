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
import { LookupStatusDto } from './dto/attribute.dto';
import { PassoutYearDto, UpdatePassoutYearDto } from './dto/passout-year.dto';
import { PassoutYearsService } from './passout-years.service';

const KEY = 'corporate_relations.company_attributes.manage';

/**
 * The passout-year master, configured from the Company Attributes screen and so
 * gated by that screen's key and actions. Separate from the parameterised
 * `attributes/:type` surface because these rows have no name — their label is
 * derived and they carry an academic date window.
 */
@ApiTags('corporate-relations/passout-years')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/corporate-relations/passout-years')
export class PassoutYearsController {
  constructor(private readonly svc: PassoutYearsService) {}

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'All passout years (active + inactive).' })
  list() {
    return this.svc.list(true);
  }

  @Post()
  @RequireScreen(KEY, 'create')
  @ApiOperation({ summary: 'Add a passout year.' })
  create(@Body() dto: PassoutYearDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({ summary: 'Edit a passout year and/or its academic window.' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePassoutYearDto,
  ) {
    return this.svc.update(id, dto);
  }

  @Patch(':id/status')
  @RequireScreen(KEY, 'activate')
  @ApiOperation({ summary: 'Activate / deactivate a passout year.' })
  setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LookupStatusDto,
  ) {
    return this.svc.setStatus(id, dto.is_active);
  }
}
