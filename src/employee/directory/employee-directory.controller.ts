import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import {
  DirectoryEmployee,
  EmployeeDirectoryService,
} from './employee-directory.service';

const csvIds = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const cleaned = arr.map((x) => String(x).trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}, z.array(z.coerce.number().int().positive()).max(50).optional());

export const DirectoryQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /** Resolve these ids instead of searching — for rendering a saved selection. */
  ids: csvIds,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export class DirectoryQueryDto extends createZodDto(DirectoryQuerySchema) {}

/**
 * Staff directory typeahead shared by every employee-portal people picker.
 *
 * Authenticated but NOT screen-gated, deliberately — the same carve-out the
 * employee holidays endpoint documents. Two things force it: the data (code,
 * name, designation, department) is institution-wide information every
 * employee can already reach from the birthdays screen, and the callers sit
 * behind DIFFERENT screens (`corporate_relations.company_management.manage`
 * for the company form, `requests.approvals.review` for the approvals screen),
 * so no single `@RequireScreen` could serve both.
 */
@ApiTags('employee-directory')
@ApiBearerAuth('employee-access-token')
@UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
@Controller('employee/directory')
export class EmployeeDirectoryController {
  constructor(private readonly svc: EmployeeDirectoryService) {}

  @Get('employees')
  @ApiOperation({
    summary:
      'Search active employees by code or name (typeahead), or resolve specific ids with `?ids=`.',
  })
  employees(@Query() query: DirectoryQueryDto): Promise<DirectoryEmployee[]> {
    if (query.ids?.length) return this.svc.byIds(query.ids);
    return this.svc.search(query.q, query.limit);
  }
}
