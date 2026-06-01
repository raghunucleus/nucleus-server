import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  HolidaysReadService,
  PaginatedHolidays,
  PublicHoliday,
} from '../../holidays/holidays-read.service';
import {
  StudentExamResultsService,
  StudentExamResultsView,
} from '../../student/exam-results/student-exam-results.service';
import {
  DashboardResult,
  StudentPortalService,
  SubjectSessionsResult,
  WeekResult,
} from '../../student/portal/student-portal.service';
import { GuardianJwtAuthGuard } from '../auth/guardian-jwt-auth.guard';
import { GuardianRequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { GuardianLinkGuard } from './guardian-link.guard';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const WeekQuerySchema = z
  .object({
    week_start: z.string().regex(ISO_DATE_RE),
    week_end: z.string().regex(ISO_DATE_RE),
    day_of_week: z.coerce.number().int().min(1).max(7).optional(),
  })
  .strict()
  .refine((v) => v.week_end >= v.week_start, {
    message: 'week_end must not be before week_start',
    path: ['week_end'],
  });

class WeekQueryDto extends createZodDto(WeekQuerySchema) {}

const HolidayRangeSchema = z
  .object({
    from: z.string().regex(ISO_DATE_RE).optional(),
    to: z.string().regex(ISO_DATE_RE).optional(),
    scope: z.enum(['upcoming', 'past']).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: 'to must not be before from',
    path: ['to'],
  });

class HolidayRangeDto extends createZodDto(HolidayRangeSchema) {}

const HolidayPageSchema = z
  .object({
    from: z.string().regex(ISO_DATE_RE).optional(),
    to: z.string().regex(ISO_DATE_RE).optional(),
    scope: z.enum(['upcoming', 'past']).optional(),
    page: z.coerce.number().int().positive().optional(),
    page_size: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.to >= v.from, {
    message: 'to must not be before from',
    path: ['to'],
  });

class HolidayPageDto extends createZodDto(HolidayPageSchema) {}

/**
 * Read-only academic views for a guardian, scoped to a specific linked child.
 *
 * The acting guardian comes from the JWT; the target student is the
 * `:studentId` route param. GuardianLinkGuard verifies the guardian↔student
 * link (and that the student is active) before any handler runs, then we
 * delegate to the exact same services the student portal uses — passing the
 * validated param id.
 */
@ApiTags('guardian-portal')
@ApiBearerAuth('guardian-access-token')
@UseGuards(
  GuardianJwtAuthGuard,
  GuardianRequirePasswordChangedGuard,
  GuardianLinkGuard,
)
@Controller('guardian/students/:studentId')
export class GuardianAcademicsController {
  constructor(
    private readonly portal: StudentPortalService,
    private readonly examResults: StudentExamResultsService,
    private readonly holidays: HolidaysReadService,
  ) {}

  @Get('timetable/week')
  @ApiOperation({ summary: "The child's class sessions in a date window." })
  week(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: WeekQueryDto,
  ): Promise<WeekResult> {
    return this.portal.week(
      studentId,
      query.week_start,
      query.week_end,
      query.day_of_week,
    );
  }

  @Get('attendance/dashboard')
  @ApiOperation({
    summary: "Per-subject and overall attendance % for the child.",
  })
  dashboard(
    @Param('studentId', ParseIntPipe) studentId: number,
  ): Promise<DashboardResult> {
    return this.portal.dashboard(studentId);
  }

  @Get('attendance/subject/:subjectId/sessions')
  @ApiOperation({
    summary: "Per-session attendance for one subject for the child.",
  })
  subjectSessions(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Param('subjectId', ParseIntPipe) subjectId: number,
  ): Promise<SubjectSessionsResult> {
    return this.portal.subjectSessions(studentId, subjectId);
  }

  @Get('exam-results')
  @ApiOperation({
    summary:
      "The child's exam results: CGPA, per-semester SGPA, best-attempt grades.",
  })
  examResultsView(
    @Param('studentId', ParseIntPipe) studentId: number,
  ): Promise<StudentExamResultsView> {
    return this.examResults.myResults(studentId);
  }

  @Get('academic-holidays')
  @ApiOperation({ summary: 'Declared institution-wide holidays.' })
  holidaysList(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: HolidayRangeDto,
  ): Promise<PublicHoliday[]> {
    return this.holidays.listForStudent(studentId, {
      from: query.from,
      to: query.to,
      scope: query.scope,
    });
  }

  @Get('academic-holidays/paged')
  @ApiOperation({ summary: 'Paginated institution-wide holidays.' })
  holidaysPaged(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: HolidayPageDto,
  ): Promise<PaginatedHolidays> {
    return this.holidays.listForStudentPaged(studentId, {
      from: query.from,
      to: query.to,
      scope: query.scope,
      page: query.page,
      page_size: query.page_size,
    });
  }
}
