import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { StudentSearchDto } from '../../student-query/dto/student-search.dto';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { GetEmployee } from '../auth/get-employee.decorator';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { DriveStudentsService } from './drive-students.service';
import { ImportDriveStudentsDto } from './dto/import-drive-students.dto';
import { InviteDriveStudentsDto } from './dto/invite-drive-students.dto';
import { MarkDriveStudentOutcomeDto } from './dto/mark-drive-student-outcome.dto';
import { RevokeDriveStudentsDto } from './dto/revoke-drive-students.dto';
import { UpdateDriveStudentSelectionDto } from './dto/update-drive-student-selection.dto';

const KEY = 'drive_management.drives.manage';

/** Parse a CSV of positive ints (`"3,7"`) — undefined when nothing valid. */
const csvInts = (v?: string): number[] | undefined => {
  const ids = (v ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? ids : undefined;
};

/**
 * The drive's persisted shortlist — the "Students" tab and the import from the
 * Filter tab. Reads (the list) require `view`; every mutation (import, remove)
 * requires `edit`. Shares the base route with
 * {@link DriveStudentsSearchController}; the sub-paths don't collide.
 */
@ApiTags('drive-management/drive-students')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/drive-management/drives/:driveId/students')
export class DriveStudentsController {
  constructor(private readonly svc: DriveStudentsService) {}

  @Get()
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "The drive's imported students (paginated), optionally filtered by " +
      'lifecycle status, programmes, passout years and entry type. `all=1` ' +
      'skips pagination (capped) for the grouped view.',
  })
  list(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('programme_ids') programmeIds?: string,
    @Query('passout_years') passoutYears?: string,
    @Query('entry_type') entryType?: string,
    @Query('all') all?: string,
  ) {
    const parsedStatus = Number(status);
    return this.svc.list(driveId, {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 25,
      search,
      status:
        Number.isInteger(parsedStatus) && status !== undefined && status !== ''
          ? parsedStatus
          : undefined,
      programmeIds: csvInts(programmeIds),
      passoutYears: csvInts(passoutYears),
      entryType:
        entryType === '1' || entryType === '2' ? Number(entryType) : undefined,
      all: all === '1' || all === 'true',
    });
  }

  @Get('filter-options')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      'Distinct programme / passout-year / entry-type values present among ' +
      "the drive's students — the filter dropdown options.",
  })
  filterOptions(@Param('driveId', ParseIntPipe) driveId: number) {
    return this.svc.filterOptions(driveId);
  }

  @Post('import')
  @HttpCode(200)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Import explicit student ids into the drive (record-level or small ' +
      'batch). Duplicates are skipped and reported as `already_existed`.',
  })
  import(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: ImportDriveStudentsDto,
  ) {
    return this.svc.import_(driveId, e.id, dto.student_ids);
  }

  @Post('import-all')
  @HttpCode(200)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Import every student matching the current Filter query (bounded — an ' +
      'oversized set is rejected with a 400 asking to narrow the filters).',
  })
  importAll(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: StudentSearchDto,
  ) {
    return this.svc.importAll(driveId, e.id, dto);
  }

  @Post('invite')
  @HttpCode(200)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Invite (or re-invite) explicit student ids (→ 20 + notification). ' +
      'Imported (10), Denied (40) and Revoked (80) rows move; the rest are ' +
      'reported as `skipped`. Drive must be published.',
  })
  invite(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: InviteDriveStudentsDto,
  ) {
    return this.svc.invite(driveId, e.id, dto.student_ids);
  }

  @Post('invite-all')
  @HttpCode(200)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Invite every still-Imported (status 10) student in the drive. Drive ' +
      'must be published.',
  })
  inviteAll(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
  ) {
    return this.svc.inviteAll(driveId, e.id);
  }

  @Post('remind')
  @HttpCode(200)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Re-send the invitation notification to Invited students who have not ' +
      'yet responded (no status change). Non-Invited rows are `skipped`.',
  })
  remind(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: InviteDriveStudentsDto,
  ) {
    return this.svc.remind(driveId, e.id, dto.student_ids);
  }

  @Post('outcome')
  @HttpCode(200)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Record the drive-day outcome (50 Not Attended / 60 Selected / 70 Not ' +
      'Selected) for Accepted students. Non-Accepted rows are `skipped`. ' +
      'Selected additionally records the designation + package, one set ' +
      'applied to the whole batch.',
  })
  markOutcome(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: MarkDriveStudentOutcomeDto,
  ) {
    return this.svc.markOutcome(
      driveId,
      e.id,
      dto.student_ids,
      dto.status,
      dto.status === 60
        ? {
            drive_profile_id: dto.drive_profile_id!,
            ctc: dto.ctc ?? null,
            ctc_min: dto.ctc_min ?? null,
            stipend: dto.stipend ?? null,
            stipend_min: dto.stipend_min ?? null,
          }
        : undefined,
    );
  }

  @Patch(':studentId/selection')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Edit the designation/package recorded on a Selected (60) student. ' +
      'Full replacement, re-validated against the offer type; audit-logged.',
  })
  updateSelection(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Body() dto: UpdateDriveStudentSelectionDto,
  ) {
    return this.svc.updateSelection(driveId, e.id, studentId, {
      drive_profile_id: dto.drive_profile_id,
      ctc: dto.ctc ?? null,
      ctc_min: dto.ctc_min ?? null,
      stipend: dto.stipend ?? null,
      stipend_min: dto.stipend_min ?? null,
    });
  }

  @Post('revoke')
  @HttpCode(200)
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Revoke Invited/Accepted students (20/30 → 80) with a required reason. ' +
      '`notify` (default true) controls whether the student is notified.',
  })
  revoke(
    @GetEmployee() e: AuthenticatedEmployee,
    @Param('driveId', ParseIntPipe) driveId: number,
    @Body() dto: RevokeDriveStudentsDto,
  ) {
    return this.svc.revoke(
      driveId,
      e.id,
      dto.student_ids,
      dto.reason,
      dto.notify,
    );
  }

  @Get(':studentId/track')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "One student's full audit trail in this drive — every status change and " +
      'action with actor + reason, oldest first.',
  })
  track(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.svc.getTrack(driveId, studentId);
  }

  @Get(':studentId/profile')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "A drive student's full profile — registry groups with resolved FK " +
      'names, certifications and resume links. Government IDs are excluded.',
  })
  profile(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.svc.getStudentProfile(driveId, studentId);
  }

  @Get(':studentId/drive-activity')
  @RequireScreen(KEY, 'view')
  @ApiOperation({
    summary:
      "A drive student's lifecycle across every OTHER drive (including " +
      'Imported-only rows), latest activity first.',
  })
  driveActivity(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.svc.driveActivity(driveId, studentId);
  }

  @Delete(':studentId')
  @RequireScreen(KEY, 'edit')
  @ApiOperation({
    summary:
      'Hard-delete a student from the drive — only allowed on Imported rows; ' +
      'rows already in the lifecycle must be revoked instead.',
  })
  remove(
    @Param('driveId', ParseIntPipe) driveId: number,
    @Param('studentId', ParseIntPipe) studentId: number,
  ) {
    return this.svc.remove(driveId, studentId);
  }
}
