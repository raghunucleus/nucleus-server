import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { DATE_RE } from '../dto/create-timetable.dto';
import {
  DashboardResult,
  StudentAttendanceQueryService,
  WeekCell,
} from './student-attendance-query.service';

const StudentDashboardQuerySchema = z
  .object({
    programme_semester_id: z.coerce.number().int().positive().optional(),
  })
  .strict();

class StudentDashboardQueryDto extends createZodDto(
  StudentDashboardQuerySchema,
) {}

const StudentWeekQuerySchema = z
  .object({
    week_start: z.string().regex(DATE_RE),
    week_end: z.string().regex(DATE_RE),
  })
  .strict()
  .refine((v) => v.week_end >= v.week_start, {
    message: 'week_end must not be before week_start',
    path: ['week_end'],
  });

class StudentWeekQueryDto extends createZodDto(StudentWeekQuerySchema) {}

@ApiTags('student-attendance')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/students/:studentId/attendance')
export class StudentAttendanceController {
  constructor(private readonly q: StudentAttendanceQueryService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Per-subject and overall % for the student. Defaults to their current ongoing programme semester.',
  })
  dashboard(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: StudentDashboardQueryDto,
  ): Promise<DashboardResult> {
    return this.q.dashboard(studentId, query.programme_semester_id);
  }

  @Get('week')
  @ApiOperation({ summary: "Student's class sessions in a date window." })
  week(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query() query: StudentWeekQueryDto,
  ): Promise<WeekCell[]> {
    return this.q.week(studentId, query.week_start, query.week_end);
  }
}
