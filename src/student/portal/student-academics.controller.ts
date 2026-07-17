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
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import {
  DashboardResult,
  StudentPortalService,
  SubjectSessionsResult,
  WeekResult,
} from './student-portal.service';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const WeekQuerySchema = z
  .object({
    week_start: z.string().regex(ISO_DATE_RE),
    week_end: z.string().regex(ISO_DATE_RE),
    // Optional ISO weekday filter (1=Mon..7=Sun). Lets the client lazy
    // fetch just one day's cells at a time — students who only check
    // "today" don't pay for the rest of the week. Omitting it returns
    // the whole window (original behavior).
    day_of_week: z.coerce.number().int().min(1).max(7).optional(),
  })
  .strict()
  .refine((v) => v.week_end >= v.week_start, {
    message: 'week_end must not be before week_start',
    path: ['week_end'],
  });

class WeekQueryDto extends createZodDto(WeekQuerySchema) {}

@ApiTags('student-academics')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student')
export class StudentAcademicsController {
  constructor(private readonly portal: StudentPortalService) {}

  @Get('timetable/week')
  @ApiOperation({
    summary:
      "The signed-in student's class sessions in a date window, along with " +
      'the bell schedule and working-days metadata.',
  })
  week(
    @GetStudent() student: AuthenticatedStudent,
    @Query() query: WeekQueryDto,
  ): Promise<WeekResult> {
    return this.portal.week(
      student.id,
      query.week_start,
      query.week_end,
      query.day_of_week,
    );
  }

  @Get('attendance/dashboard')
  @ApiOperation({
    summary:
      'Per-subject and overall attendance % for the signed-in student in ' +
      'their current ongoing programme semester.',
  })
  dashboard(
    @GetStudent() student: AuthenticatedStudent,
  ): Promise<DashboardResult> {
    return this.portal.dashboard(student.id);
  }

  @Get('attendance/subject/:subjectId/sessions')
  @ApiOperation({
    summary:
      'Every class_session for one subject that the signed-in student was on ' +
      'the roster for, with their per-session attendance mark. Drives the ' +
      'drill-down view on the attendance dashboard.',
  })
  subjectSessions(
    @GetStudent() student: AuthenticatedStudent,
    @Param('subjectId', ParseIntPipe) subjectId: number,
  ): Promise<SubjectSessionsResult> {
    return this.portal.subjectSessions(student.id, subjectId);
  }
}
