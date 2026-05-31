import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import {
  ChunkUploadDto,
  CommitUploadDto,
  ResultsQueryDto,
  SessionQueryDto,
  StartUploadDto,
  StudentResultsQueryDto,
} from './dto/upload-marks.dto';
import {
  ChunkResult,
  CommitResult,
  ExamMarksScopeItem,
  ExamMarksService,
  PreviewResult,
  PreviewStudent,
  StartUploadResult,
} from './exam-marks.service';

/**
 * Exam-cell grade-sheet upload. Every handler is scoped to the (programme ×
 * admission-year) batches the admin granted on the assignment, read via the
 * RBAC `programme_admission_year_ids` attribute on the
 * `examinations.marks.upload` screen.
 *
 * Upload is chunked so it scales to lakhs of rows: `uploads/start` opens a
 * session, `uploads/:session/chunk` streams parsed rows into a staging table,
 * `uploads/:session/preview` returns the student-wise summary (computed
 * server-side, nothing written), and `uploads/:session/commit` atomically
 * replaces the batch's stored results + cached SGPA/CGPA from staging.
 */
@ApiTags('exam-marks')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/exam-marks')
export class ExamMarksController {
  constructor(private readonly svc: ExamMarksService) {}

  @Get('scope')
  @RequireScreen('examinations.marks.upload', 'upload')
  @ApiOperation({
    summary:
      'The (programme × admission-year) batches the signed-in employee may ' +
      'upload marks for — drives the batch filter on the upload screen.',
  })
  scope(
    @GetEmployee() employee: AuthenticatedEmployee,
  ): Promise<ExamMarksScopeItem[]> {
    return this.svc.scope(employee.id);
  }

  @Post('uploads/start')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('examinations.marks.upload', 'upload')
  @ApiOperation({
    summary:
      'Open a chunked upload session for a batch (sweeps prior staging rows). ' +
      'Returns an upload_session id to stream chunks into.',
  })
  startUpload(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() body: StartUploadDto,
  ): Promise<StartUploadResult> {
    return this.svc.startUpload(employee.id, body.programme_admission_year_id);
  }

  @Post('uploads/chunk')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('examinations.marks.upload', 'upload')
  @ApiOperation({
    summary:
      'Stream one chunk of parsed rows into a session; validates server-side ' +
      'and returns per-cell errors for this chunk.',
  })
  uploadChunk(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() body: ChunkUploadDto,
  ): Promise<ChunkResult> {
    return this.svc.uploadChunk(
      employee.id,
      body.programme_admission_year_id,
      body.upload_session,
      body.offset,
      body.rows,
    );
  }

  @Get('uploads/preview')
  @RequireScreen('examinations.marks.upload', 'upload')
  @ApiOperation({
    summary:
      'Validate the staged session and return the student-wise SGPA/CGPA ' +
      'summary (server-computed). Nothing is written.',
  })
  previewUpload(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: SessionQueryDto,
  ): Promise<PreviewResult> {
    return this.svc.previewUpload(
      employee.id,
      query.programme_admission_year_id,
      query.upload_session,
    );
  }

  @Get('uploads/students/:studentId/detail')
  @RequireScreen('examinations.marks.upload', 'upload')
  @ApiOperation({
    summary:
      "One staged student's full detail (semesters → best subjects → all " +
      'attempts), computed server-side on demand for the preview drill-down.',
  })
  studentUploadDetail(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: SessionQueryDto,
  ): Promise<PreviewStudent> {
    return this.svc.studentUploadDetail(
      employee.id,
      query.programme_admission_year_id,
      query.upload_session,
      studentId,
    );
  }

  @Post('uploads/commit')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('examinations.marks.upload', 'upload')
  @ApiOperation({
    summary:
      'Atomically replace ALL stored results + cached SGPA/CGPA for the batch ' +
      'from the staged session. All-or-nothing.',
  })
  commitUpload(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() body: CommitUploadDto,
  ): Promise<CommitResult> {
    return this.svc.commitUpload(
      employee.id,
      body.programme_admission_year_id,
      body.upload_session,
    );
  }

  @Get('results')
  @RequireScreen('examinations.marks.upload', 'upload')
  @ApiOperation({
    summary:
      "A batch's students with their cached CGPA and backlog count — pure " +
      'read of the cached aggregates.',
  })
  results(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: ResultsQueryDto,
  ) {
    return this.svc.results(employee.id, query.programme_admission_year_id);
  }

  @Get('students/:studentId/results')
  @RequireScreen('examinations.marks.upload', 'upload')
  @ApiOperation({
    summary:
      "One student's stored results: cached CGPA, per-semester SGPA and the " +
      'subject rows (best attempts by default, all sittings with include=all).',
  })
  studentResults(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: StudentResultsQueryDto,
  ) {
    return this.svc.studentResults(
      employee.id,
      query.programme_admission_year_id,
      studentId,
      query.include,
    );
  }
}
