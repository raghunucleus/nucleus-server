import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../../rbac/screen-access.guard';
import {
  ParseNqlDto,
  StudentSearchDto,
} from '../../../student-query/dto/student-search.dto';
import { EmployeeJwtAuthGuard } from '../../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../../auth/require-password-changed.guard';
import { InsightsScopeQueryDto } from '../dto/insights-query.dto';
import {
  INSIGHTS_SCREEN_KEYS,
  InsightsScopeService,
} from '../insights-scope.service';
import { InsightsStudentsService } from './insights-students.service';

const KEY = INSIGHTS_SCREEN_KEYS.students;

/**
 * Demographics (GET) plus the cohort explorer — the same POST search surface
 * the student directory exposes, scoped to the insights grant. The POSTs are
 * reads (search bodies too large for a query string) and the export merely
 * queues a job; nothing here mutates student data.
 */
@ApiTags('insights')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/insights/students')
export class InsightsStudentsController {
  constructor(
    private readonly scope: InsightsScopeService,
    private readonly svc: InsightsStudentsService,
  ) {}

  @Get('demographics')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Per batch: headcount, inactive, gender, entry type, guardian linkage and profile completeness; plus the top home districts.',
  })
  async demographics(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsScopeQueryDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return scope
      ? this.svc.demographics(scope)
      : { by_batch: [], districts: [] };
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Search students within the insights scope with dynamic filters (structured or NQL), columns, sort and pagination. Scope narrowing rides on the query string.',
  })
  async search(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsScopeQueryDto,
    @Body() dto: StudentSearchDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return this.svc.search(scope, dto);
  }

  @Get('search/meta')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Attribute registry for the cohort explorer.' })
  meta() {
    return this.svc.meta();
  }

  @Get('search/options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'id/label options for one fk-kind attribute.' })
  options(@Query('lookup') lookup: string, @Query('q') q?: string) {
    return this.svc.fkOptions(lookup, q);
  }

  @Post('search/parse-nql')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(KEY, 'view')
  @ApiOperation({ summary: 'Compile an NQL string to the filter AST.' })
  parseNql(@Body() dto: ParseNqlDto) {
    return this.svc.parseNql(dto.nql);
  }

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Start an async CSV/XLSX export of the current in-scope cohort search.',
  })
  async export(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() q: InsightsScopeQueryDto,
    @Body() dto: StudentSearchDto,
  ) {
    const scope = await this.scope.resolve(employee.id, KEY, q);
    return this.svc.export(employee.id, scope, dto);
  }
}
