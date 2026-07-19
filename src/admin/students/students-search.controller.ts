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
import {
  exportFilename,
  rowsToCsv,
  rowsToXlsx,
} from '../../student-query/export';
import { StudentSearchDto } from '../../student-query/dto/student-search.dto';
import { StudentQueryService } from '../../student-query/student-query.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';

/**
 * Registry-driven student search — dynamic filters (structured or NQL),
 * selectable columns, free-text search, sort, pagination, CSV/XLSX export.
 * Admin surface: unscoped (admins see all students). POST because the filter
 * payload is a structured JSON body; the endpoint is read-only.
 */
@ApiTags('students')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/students')
export class StudentsSearchController {
  constructor(private readonly engine: StudentQueryService) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Search students with dynamic attribute filters (structured or NQL), column selection, sort and pagination.',
  })
  async search(
    @Body() dto: StudentSearchDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.engine.search(dto, { surface: 'admin' });
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
  @ApiOperation({
    summary:
      'Filterable/selectable/sortable attribute registry for the search UI (filter builder + NQL autocomplete).',
  })
  meta() {
    return this.engine.meta('admin');
  }

  @Get('search/options')
  @ApiOperation({
    summary:
      'id/label options for one fk-kind attribute (`lookup` from meta), ' +
      'optionally narrowed by `q`.',
  })
  options(@Query('lookup') lookup: string, @Query('q') q?: string) {
    return this.engine.fkOptions(lookup, q);
  }
}
