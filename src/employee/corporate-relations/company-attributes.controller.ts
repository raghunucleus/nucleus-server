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
import { CompanyAttributesService } from './company-attributes.service';
import {
  LookupDto,
  LookupStatusDto,
  UpdateLookupDto,
} from './dto/attribute.dto';

const KEY = 'corporate_relations.company_attributes.manage';

/**
 * Configure the company classifier lookups (category, industry, type, size,
 * source, hiring-modes, roles, tags). `:type` is validated against the
 * whitelist inside the service. Manager-only screen.
 */
@ApiTags('corporate-relations/attributes')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/corporate-relations/attributes')
export class CompanyAttributesController {
  constructor(private readonly svc: CompanyAttributesService) {}

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
  create(@Param('type') type: string, @Body() dto: LookupDto) {
    return this.svc.create(type, dto);
  }

  @Patch(':type/:id')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({ summary: 'Rename / reorder a lookup value.' })
  update(
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLookupDto,
  ) {
    return this.svc.update(type, id, dto);
  }

  @Patch(':type/:id/status')
  @RequireScreen(KEY, 'activate')
  @ApiOperation({ summary: 'Activate / deactivate a lookup value.' })
  setStatus(
    @Param('type') type: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LookupStatusDto,
  ) {
    return this.svc.setStatus(type, id, dto.is_active);
  }
}
