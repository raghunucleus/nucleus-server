import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { ResultsQueryDto, StudentByRollQueryDto } from './dto/upload-marks.dto';
import {
  ExamMarksScopeItem,
  ExamMarksService,
  VIEW_SCREEN_KEY,
} from './exam-marks.service';

/**
 * Read-only "Student marks" view for the exam cell. Surfaces the already
 * committed results — the whole-roster (branch-wise) list and one student's
 * full semester / subject breakdown — for the (programme × admission-year)
 * batches the employee is scoped to.
 *
 * Access rides on the marks-upload grant: the `examinations.marks.view` screen
 * is derived from `examinations.marks.upload` in PermissionsService, so anyone
 * who can upload a batch's marks can view them with the identical scope. Every
 * read therefore passes {@link VIEW_SCREEN_KEY} to the service so the scope
 * helpers resolve against this screen's (copied) attribute. Pure SELECTs — this
 * controller never writes.
 */
@ApiTags('exam-marks')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/exam-marks/view')
export class StudentMarksController {
  constructor(private readonly svc: ExamMarksService) {}

  @Get('scope')
  @RequireScreen(VIEW_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      'The (programme × admission-year) batches the signed-in employee may ' +
      'view marks for — drives the batch filter on the Student marks screen.',
  })
  scope(
    @GetEmployee() employee: AuthenticatedEmployee,
  ): Promise<ExamMarksScopeItem[]> {
    return this.svc.scope(employee.id, VIEW_SCREEN_KEY);
  }

  @Get('results')
  @RequireScreen(VIEW_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      "A batch's students with their cached CGPA and backlog count — the " +
      'branch-wise list, a pure read of the cached aggregates.',
  })
  results(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: ResultsQueryDto,
  ) {
    return this.svc.results(
      employee.id,
      query.programme_admission_year_id,
      VIEW_SCREEN_KEY,
    );
  }

  @Get('student')
  @RequireScreen(VIEW_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      "One student's results looked up by HT number, across the employee's " +
      'assigned batches (rejects a roll outside those batches).',
  })
  studentByRoll(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: StudentByRollQueryDto,
  ) {
    return this.svc.studentResultsByRoll(
      employee.id,
      query.roll_number,
      VIEW_SCREEN_KEY,
    );
  }

  @Get('students/:studentId/results')
  @RequireScreen(VIEW_SCREEN_KEY, 'view')
  @ApiOperation({
    summary:
      "One student's stored results in the same shape the student sees: " +
      'per-semester SGPA + subjects, each with its full attempt history.',
  })
  studentResults(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: ResultsQueryDto,
  ) {
    return this.svc.studentResultsView(
      employee.id,
      query.programme_admission_year_id,
      studentId,
      VIEW_SCREEN_KEY,
    );
  }
}
