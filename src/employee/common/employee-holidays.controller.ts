import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  HolidaysReadService,
  PaginatedHolidays,
  PublicHoliday,
} from '../../holidays/holidays-read.service';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';

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

/**
 * The institution academic calendar, visible to every authenticated employee.
 *
 * No `@RequireScreen` here on purpose: declared holidays are broadcast,
 * institution-wide information with no per-attribute scope — every employee
 * sees the same calendar. The handler is still gated by authentication and the
 * password-changed guard, consistent with the RBAC contract's carve-out for
 * non-attribute-scoped reads (see nucleus-server/CLAUDE.md).
 */
@ApiTags('employee-holidays')
@ApiBearerAuth('employee-access-token')
@UseGuards(EmployeeJwtAuthGuard, RequireEmployeePasswordChangedGuard)
@Controller('employee/academic-holidays')
export class EmployeeHolidaysController {
  constructor(private readonly holidays: HolidaysReadService) {}

  @Get()
  @ApiOperation({
    summary:
      'The institution academic calendar — every declared holiday, optionally within a from/to window. Visible to all employees.',
  })
  list(@Query() query: HolidayRangeDto): Promise<PublicHoliday[]> {
    return this.holidays.listForEmployee({
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
  listPaged(@Query() query: HolidayPageDto): Promise<PaginatedHolidays> {
    return this.holidays.listForEmployeePaged({
      from: query.from,
      to: query.to,
      scope: query.scope,
      page: query.page,
      page_size: query.page_size,
    });
  }
}
