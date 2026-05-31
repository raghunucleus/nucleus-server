import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  HolidaysReadService,
  PaginatedHolidays,
  PublicHoliday,
} from '../../holidays/holidays-read.service';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

@ApiTags('student-holidays')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/academic-holidays')
export class StudentHolidaysController {
  constructor(private readonly holidays: HolidaysReadService) {}

  @Get()
  @ApiOperation({
    summary:
      'Declared institution-wide holidays for the signed-in student. Optional from/to window.',
  })
  list(
    @GetStudent() student: AuthenticatedStudent,
    @Query() query: HolidayRangeDto,
  ): Promise<PublicHoliday[]> {
    return this.holidays.listForStudent(student.id, {
      from: query.from,
      to: query.to,
      scope: query.scope,
    });
  }

  @Get('paged')
  @ApiOperation({
    summary:
      'Paginated view of the same calendar as the root endpoint — for the holiday browser with year/month/range filters. Returns items plus total/has_more so the client can drive prev/next.',
  })
  listPaged(
    @GetStudent() student: AuthenticatedStudent,
    @Query() query: HolidayPageDto,
  ): Promise<PaginatedHolidays> {
    return this.holidays.listForStudentPaged(student.id, {
      from: query.from,
      to: query.to,
      scope: query.scope,
      page: query.page,
      page_size: query.page_size,
    });
  }
}
