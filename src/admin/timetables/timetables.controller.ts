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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { CloneTimetableDto } from '../dto/clone-timetable.dto';
import { CreateTimetableDto } from '../dto/create-timetable.dto';
import { CreateTimetableCourseDto } from '../dto/create-timetable-course.dto';
import { ListTimetablesDto } from '../dto/list-timetables.dto';
import { SaveTimetablePeriodsDto } from '../dto/save-timetable-periods.dto';
import { SetTimetableCourseFacultyDto } from '../dto/set-timetable-course-faculty.dto';
import { UpdateTimetableDto } from '../dto/update-timetable.dto';
import { UpdateTimetableCourseDto } from '../dto/update-timetable-course.dto';
import { UpsertTimetableEntryDto } from '../dto/upsert-timetable-entry.dto';
import { WeekSummariesDto, WeekWindowDto } from '../dto/timetable-week.dto';
import { Timetable } from '../entities/timetable.entity';
import { TimetableEntry } from '../entities/timetable-entry.entity';
import {
  TimetableSummary,
  TimetablesService,
  WeekSummary,
} from './timetables.service';
import type {
  PreviewResult,
  PublishResult,
} from '../sessions/session-seeder.service';

@ApiTags('timetables')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/timetables')
export class TimetablesController {
  constructor(private readonly timetables: TimetablesService) {}

  @Get()
  @ApiOperation({
    summary:
      'List timetables (with period/entry counts) for a programme-semester, optionally one attendance group.',
  })
  list(@Query() query: ListTimetablesDto): Promise<TimetableSummary[]> {
    return this.timetables.list(
      query.programmeSemesterId,
      query.attendanceGroupId,
    );
  }

  // --- exclusive courses — declared before ':id' routes so the literal
  // 'courses' segment is never shadowed by the :id param. ----------------------

  @Patch('courses/:courseId')
  @ApiOperation({ summary: 'Edit a timetable-exclusive course.' })
  updateCourse(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: UpdateTimetableCourseDto,
  ): Promise<Timetable> {
    return this.timetables.updateCourse(courseId, dto);
  }

  @Delete('courses/:courseId')
  @ApiOperation({ summary: 'Remove a timetable-exclusive course.' })
  removeCourse(
    @Param('courseId', ParseIntPipe) courseId: number,
  ): Promise<Timetable> {
    return this.timetables.removeCourse(courseId);
  }

  @Put('courses/:courseId/faculty')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Replace the faculty allocated to a timetable-exclusive course. Send the full list; an empty list clears it.',
  })
  setCourseFaculty(
    @Param('courseId', ParseIntPipe) courseId: number,
    @Body() dto: SetTimetableCourseFacultyDto,
  ): Promise<Timetable> {
    return this.timetables.setCourseFaculty(courseId, dto.employee_ids);
  }

  // --- single timetable -----------------------------------------------------

  @Get(':id')
  @ApiOperation({
    summary:
      'Get one timetable with its full graph — periods, exclusive courses and grid cells.',
  })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<Timetable> {
    return this.timetables.getOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a draft timetable for an attendance group within a programme-semester.',
  })
  create(@Body() dto: CreateTimetableDto): Promise<Timetable> {
    return this.timetables.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update timetable metadata — name, effective dates, working days.',
  })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTimetableDto,
  ): Promise<Timetable> {
    return this.timetables.update(id, dto);
  }

  @Post(':id/preview-week')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Preview the sessions a given week would seed without writing anything.',
  })
  previewWeek(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WeekWindowDto,
  ): Promise<PreviewResult> {
    return this.timetables.previewWeek(id, {
      from: dto.from,
      to: dto.to,
      days_of_week: dto.days_of_week,
    });
  }

  @Post(':id/publish-week')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Publish one week's sessions from the timetable's current shape. Replaces any still-scheduled sessions in the window; completed and cancelled rows are untouched.",
  })
  publishWeek(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WeekWindowDto,
  ): Promise<PublishResult> {
    return this.timetables.publishWeek(id, {
      from: dto.from,
      to: dto.to,
      days_of_week: dto.days_of_week,
    });
  }

  @Post(':id/week-summaries')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Per-week session counts (scheduled / completed / cancelled / rescheduled) for the strip view. Pass the Monday of each week to summarise.',
  })
  weekSummaries(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WeekSummariesDto,
  ): Promise<WeekSummary[]> {
    return this.timetables.getWeekSummaries(id, dto.week_starts);
  }

  @Post(':id/clone')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Clone a template into a fresh one in the same group — periods, courses and cells are copied so the admin can tweak the copy for a variant week.',
  })
  clone(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloneTimetableDto,
  ): Promise<Timetable> {
    return this.timetables.clone(id, dto);
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Mark this template as the group's default — auto-selected in the Schedule preview modal. The previous default for the same group is unset.",
  })
  setDefault(@Param('id', ParseIntPipe) id: number): Promise<Timetable> {
    return this.timetables.setDefault(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a timetable and everything in it.' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.timetables.remove(id);
  }

  // --- bell schedule --------------------------------------------------------

  @Put(':id/periods')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Replace the period rows. Rows with an id are kept (cells survive); others are inserted/deleted.',
  })
  savePeriods(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveTimetablePeriodsDto,
  ): Promise<Timetable> {
    return this.timetables.savePeriods(id, dto.periods);
  }

  // --- exclusive courses (create is nested under the timetable) --------------

  @Post(':id/courses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Add a subject exclusively to this timetable — a master subject or a free-text activity.',
  })
  createCourse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTimetableCourseDto,
  ): Promise<Timetable> {
    return this.timetables.createCourse(id, dto);
  }

  // --- grid cells -----------------------------------------------------------

  @Put(':id/entries/cell')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Place or replace the class in one cell (day × period). Returns the upserted entry.',
  })
  upsertEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertTimetableEntryDto,
  ): Promise<TimetableEntry> {
    return this.timetables.upsertEntry(id, dto);
  }

  @Delete(':id/entries/cell')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear the class from one cell (day × period).' })
  clearEntry(
    @Param('id', ParseIntPipe) id: number,
    @Query('dayOfWeek', ParseIntPipe) dayOfWeek: number,
    @Query('periodId', ParseIntPipe) periodId: number,
  ): Promise<void> {
    return this.timetables.clearEntry(id, dayOfWeek, periodId);
  }
}
