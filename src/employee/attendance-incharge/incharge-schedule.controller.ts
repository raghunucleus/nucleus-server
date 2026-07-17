import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CloneTimetableDto } from '../../admin/dto/clone-timetable.dto';
import { CreateTimetableDto } from '../../admin/dto/create-timetable.dto';
import { CreateTimetableCourseDto } from '../../admin/dto/create-timetable-course.dto';
import { ListTimetablesDto } from '../../admin/dto/list-timetables.dto';
import { SaveTimetablePeriodsDto } from '../../admin/dto/save-timetable-periods.dto';
import { SetTimetableCourseFacultyDto } from '../../admin/dto/set-timetable-course-faculty.dto';
import {
  WeekSummariesDto,
  WeekWindowDto,
} from '../../admin/dto/timetable-week.dto';
import { UpdateTimetableDto } from '../../admin/dto/update-timetable.dto';
import { UpdateTimetableCourseDto } from '../../admin/dto/update-timetable-course.dto';
import { UpsertTimetableEntryDto } from '../../admin/dto/upsert-timetable-entry.dto';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { ProgrammeSemesterSubject } from '../../admin/entities/programme-semester-subject.entity';
import { Timetable } from '../../admin/entities/timetable.entity';
import { TimetableEntry } from '../../admin/entities/timetable-entry.entity';
import type {
  PreviewResult,
  PublishResult,
} from '../../admin/sessions/session-seeder.service';
import {
  TimetableSummary,
  WeekSummary,
} from '../../admin/timetables/timetables.service';
import {
  RequireAnyScreen,
  RequireScreen,
} from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { InchargeScheduleService } from './incharge-schedule.service';

const ProgrammeSemesterLookupQuerySchema = z
  .object({
    attendance_group_id: z.coerce.number().int().positive().optional(),
  })
  .strict();
class ProgrammeSemesterLookupQueryDto extends createZodDto(
  ProgrammeSemesterLookupQuerySchema,
) {}

const PssLookupQuerySchema = z
  .object({
    programme_semester_id: z.coerce.number().int().positive(),
    attendance_group_id: z.coerce.number().int().positive(),
  })
  .strict();
class PssLookupQueryDto extends createZodDto(PssLookupQuerySchema) {}

/**
 * Templates + weekly publish endpoints for the attendance incharge. Mirrors
 * the admin's `/admin/timetables/*` surface but gated by group ownership —
 * see [[incharge-schedule.service.ts]] for the ownership check.
 *
 * Screens (split surface):
 *   - `timetable.incharge.templates.manage` — template CUD, periods,
 *      courses, grid cells. Lookups feed the template editor.
 *   - `timetable.incharge.schedule.manage`  — weekly publish + preview +
 *      summaries (the live, week/day-of operations).
 *
 * The plain timetable read endpoints (`list`, `getOne`) accept EITHER
 * screen since both UI surfaces show the template list (one for editing,
 * the other for picking-to-publish).
 *
 * Session-level mutations (cancel, substitute, move) live on the sibling
 * [[incharge-sessions.controller.ts]] under the schedule screen.
 */
@ApiTags('incharge-schedule')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/attendance-incharge/timetables')
export class InchargeScheduleController {
  constructor(private readonly svc: InchargeScheduleService) {}

  // --- lookups -----------------------------------------------------------

  @Get('lookups/programme-semesters')
  @RequireScreen('timetable.incharge.templates.manage', 'view')
  @ApiOperation({
    summary:
      "Active programme semesters reachable from the caller's owned groups. Optional attendance_group_id narrows to one owned group's batch.",
  })
  programmeSemesters(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: ProgrammeSemesterLookupQueryDto,
  ): Promise<ProgrammeSemester[]> {
    return this.svc.listProgrammeSemesters(
      employee.id,
      query.attendance_group_id,
    );
  }

  @Get('lookups/programme-semester-subjects')
  @RequireScreen('timetable.incharge.templates.manage', 'view')
  @ApiOperation({
    summary:
      "Active subjects in a programme semester, scoped to one of the caller's owned attendance groups so the response carries the group's faculty allocation.",
  })
  programmeSemesterSubjects(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: PssLookupQueryDto,
  ): Promise<ProgrammeSemesterSubject[]> {
    return this.svc.listProgrammeSemesterSubjects(
      employee.id,
      query.programme_semester_id,
      query.attendance_group_id,
    );
  }

  @Get('lookups/employees')
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      'Active employees (id, code, display name). Used by the timetable-exclusive course faculty picker.',
  })
  employees(): Promise<
    { id: number; emp_code: string; emp_display_name: string }[]
  > {
    return this.svc.listAllocatableEmployees();
  }

  // --- listings ----------------------------------------------------------

  @Get()
  @RequireAnyScreen(
    { screenKey: 'timetable.incharge.templates.manage', action: 'view' },
    { screenKey: 'timetable.incharge.schedule.manage', action: 'view' },
  )
  @ApiOperation({
    summary:
      "Timetables in groups the caller is incharge of. Optionally filter by programme_semester and / or one of the caller's owned groups.",
  })
  list(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: ListTimetablesDto,
  ): Promise<TimetableSummary[]> {
    return this.svc.list(
      employee.id,
      query.programmeSemesterId,
      query.attendanceGroupId,
    );
  }

  // Literal-segment routes go before the `:id` param routes so `courses` is
  // never matched as a timetable id.

  @Patch('courses/:courseId')
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({ summary: 'Edit a timetable-exclusive course.' })
  updateCourse(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: UpdateTimetableCourseDto,
  ): Promise<Timetable> {
    return this.svc.updateCourse(employee.id, courseId, dto);
  }

  @Delete('courses/:courseId')
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({ summary: 'Remove a timetable-exclusive course.' })
  removeCourse(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('courseId', ParseIntPipe) courseId: number,
  ): Promise<Timetable> {
    return this.svc.removeCourse(employee.id, courseId);
  }

  @Put('courses/:courseId/faculty')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      'Replace the faculty allocated to a timetable-exclusive course. Send the full list; an empty list clears it.',
  })
  setCourseFaculty(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: SetTimetableCourseFacultyDto,
  ): Promise<Timetable> {
    return this.svc.setCourseFaculty(employee.id, courseId, dto.employee_ids);
  }

  // --- single timetable --------------------------------------------------

  @Get(':id')
  @RequireAnyScreen(
    { screenKey: 'timetable.incharge.templates.manage', action: 'view' },
    { screenKey: 'timetable.incharge.schedule.manage', action: 'view' },
  )
  @ApiOperation({
    summary:
      'Get one timetable with its full graph — periods, exclusive courses and grid cells.',
  })
  getOne(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Timetable> {
    return this.svc.getOne(employee.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      'Create a new timetable template in one of the caller’s owned groups.',
  })
  create(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Body() dto: CreateTimetableDto,
  ): Promise<Timetable> {
    return this.svc.create(employee.id, dto);
  }

  @Patch(':id')
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      'Update timetable metadata — name, working days. Cells on a removed working day are pruned.',
  })
  update(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTimetableDto,
  ): Promise<Timetable> {
    return this.svc.update(employee.id, id, dto);
  }

  @Post(':id/preview-week')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.schedule.manage', 'view')
  @ApiOperation({
    summary:
      'Preview the sessions a given week would seed without writing anything.',
  })
  previewWeek(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WeekWindowDto,
  ): Promise<PreviewResult> {
    return this.svc.previewWeek(employee.id, id, {
      from: dto.from,
      to: dto.to,
      days_of_week: dto.days_of_week,
    });
  }

  @Post(':id/publish-week')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.schedule.manage', 'publish')
  @ApiOperation({
    summary:
      "Publish one week's sessions to the group's students. Replaces still-scheduled sessions in the window; completed and cancelled rows are untouched.",
  })
  publishWeek(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WeekWindowDto,
  ): Promise<PublishResult> {
    return this.svc.publishWeek(
      employee.id,
      id,
      {
        from: dto.from,
        to: dto.to,
        days_of_week: dto.days_of_week,
        exclude: dto.exclude,
      },
      dto.notify ?? true,
    );
  }

  @Post(':id/week-summaries')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.schedule.manage', 'view')
  @ApiOperation({
    summary:
      'Per-week session counts for the strip view. Pass the Monday of each week to summarise.',
  })
  weekSummaries(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WeekSummariesDto,
  ): Promise<WeekSummary[]> {
    return this.svc.getWeekSummaries(employee.id, id, dto.week_starts);
  }

  @Post(':id/clone')
  @HttpCode(HttpStatus.CREATED)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      'Clone a template into a fresh one in the same group — periods, courses and cells are copied.',
  })
  clone(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloneTimetableDto,
  ): Promise<Timetable> {
    return this.svc.clone(employee.id, id, dto);
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      "Mark this template as the group's default — auto-selected in publish flows.",
  })
  setDefault(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Timetable> {
    return this.svc.setDefault(employee.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({ summary: 'Delete a timetable and everything in it.' })
  remove(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.svc.remove(employee.id, id);
  }

  // --- bell schedule -----------------------------------------------------

  @Put(':id/periods')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      'Replace the bell schedule. Rows with an id are kept (cells survive); others are inserted/deleted.',
  })
  savePeriods(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveTimetablePeriodsDto,
  ): Promise<Timetable> {
    return this.svc.savePeriods(employee.id, id, dto.periods);
  }

  // --- exclusive courses -------------------------------------------------

  @Post(':id/courses')
  @HttpCode(HttpStatus.CREATED)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      'Add a subject exclusively to this timetable — a master subject or a free-text activity.',
  })
  createCourse(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTimetableCourseDto,
  ): Promise<Timetable> {
    return this.svc.createCourse(employee.id, id, dto);
  }

  // --- grid cells --------------------------------------------------------

  @Put(':id/entries/cell')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({
    summary:
      'Place or replace the class in one cell (day × period). Returns the upserted entry.',
  })
  upsertEntry(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertTimetableEntryDto,
  ): Promise<TimetableEntry> {
    return this.svc.upsertEntry(employee.id, id, dto);
  }

  @Delete(':id/entries/cell')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireScreen('timetable.incharge.templates.manage', 'edit')
  @ApiOperation({ summary: 'Clear the class from one cell (day × period).' })
  clearEntry(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Query('dayOfWeek', ParseIntPipe) dayOfWeek: number,
    @Query('periodId', ParseIntPipe) periodId: number,
  ): Promise<void> {
    return this.svc.clearEntry(employee.id, id, dayOfWeek, periodId);
  }
}
