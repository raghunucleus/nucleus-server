import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import {
  exportFilename,
  rowsToCsv,
  rowsToXlsx,
} from '../../student-query/export';
import { StudentSearchDto } from '../../student-query/dto/student-search.dto';
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
      'Search students in your assigned scope with dynamic filters (structured or NQL), column selection, sort and pagination.',
  })
  async search(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() dto: StudentSearchDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.svc.search(employee.id, dto);
    if (dto.format === 'json') return result;

    const filename = exportFilename(dto.format);
    const buffer =
      dto.format === 'csv'
        ? rowsToCsv(result.columns, result.rows)
        : await rowsToXlsx(result.columns, result.rows);
    res.setHeader(
      'Content-Type',
      dto.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return new StreamableFile(buffer);
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
}
