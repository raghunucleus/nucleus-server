import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { GetEmployee } from '../auth/get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { ExportJobDto, ExportJobsService } from './export-jobs.service';

/**
 * REST surface for an employee's own export jobs ("My exports").
 *
 * No ScreenAccessGuard on purpose — same shape as the notifications
 * controller: every route is self-scoped to the caller's own jobs, taken ONLY
 * from the JWT. Creating a job is NOT possible here; creation happens inside
 * the feature that owns the data (e.g. the drive student search), under that
 * feature's own RBAC screen.
 */
@ApiTags('employee-exports')
@ApiBearerAuth('employee-access-token')
@UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
@Controller('employee/exports')
export class ExportsController {
  constructor(private readonly exports: ExportJobsService) {}

  @Get()
  @ApiOperation({
    summary: "The caller's export jobs, newest first (capped at 100).",
  })
  list(@GetEmployee() e: AuthenticatedEmployee): Promise<ExportJobDto[]> {
    return this.exports.listMine(e.id);
  }

  @Get(':id/download')
  @ApiOperation({
    summary:
      'A short-lived presigned download URL for one finished export. 409 while ' +
      'generating, 410 once failed or expired (files live for 24 hours).',
  })
  download(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ url: string }> {
    return this.exports.downloadUrl(e.id, id);
  }
}
