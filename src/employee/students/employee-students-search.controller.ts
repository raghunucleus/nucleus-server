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
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import {
  ParseNqlDto,
  StudentSearchDto,
} from '../../student-query/dto/student-search.dto';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import {
  EmployeeStudentsSearchService,
  STUDENT_DIRECTORY_SCREEN_KEY,
} from './employee-students-search.service';

/**
 * Employee student directory. Every result set is pre-filtered by the
 * employee's assigned scope (departments / programmes / admission years /
 * sections) — the RBAC attributes are mandatory predicates the request body
 * cannot override.
 */
@ApiTags('employee-students')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/students')
export class EmployeeStudentsSearchController {
  constructor(private readonly svc: EmployeeStudentsSearchService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(STUDENT_DIRECTORY_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Search students in your assigned scope with dynamic filters (structured or NQL), column selection, sort and pagination (JSON only — use /employee/students/export for files).',
  })
  search(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() dto: StudentSearchDto,
  ) {
    return this.svc.search(employee.id, dto);
  }

  @Get('search/meta')
  @RequireScreen(STUDENT_DIRECTORY_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Attribute registry for the employee search UI (gov-ID attributes excluded).',
  })
  meta() {
    return this.svc.meta();
  }

  @Get('search/options')
  @RequireScreen(STUDENT_DIRECTORY_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'id/label options for one fk-kind attribute (`lookup` from meta), ' +
      'optionally narrowed by `q`.',
  })
  options(@Query('lookup') lookup: string, @Query('q') q?: string) {
    return this.svc.options(lookup, q);
  }

  @Post('search/parse-nql')
  @HttpCode(HttpStatus.OK)
  @RequireScreen(STUDENT_DIRECTORY_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Compile an NQL string to the filter AST so the Filters tab can rebuild ' +
      'its visual rows from a query. Syntax errors return 400.',
  })
  parseNql(@Body() dto: ParseNqlDto) {
    return this.svc.parseNql(dto.nql);
  }

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScreen(STUDENT_DIRECTORY_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'Start an async CSV/XLSX export of the current in-scope search. Returns ' +
      'the job id; completion arrives as an in-app notification and the file ' +
      'expires after 24 hours.',
  })
  export(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() dto: StudentSearchDto,
  ) {
    return this.svc.export(employee.id, dto);
  }
}
