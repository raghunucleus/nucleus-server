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
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DATE_RE } from '../../admin/dto/create-timetable.dto';
import {
  CancelSessionDto,
  MoveSessionDto,
  SubstituteSessionDto,
  UncancelSessionDto,
} from '../../admin/dto/session-mutations.dto';
import { ClassSession } from '../../admin/entities/class-session.entity';
import type { RosterStudent } from '../../admin/sessions/roster.service';
import { RequireScreen } from '../../rbac/require-screen.decorator';
import { ScreenAccessGuard } from '../../rbac/screen-access.guard';
import { EmployeeJwtAuthGuard } from '../auth/employee-jwt-auth.guard';
import { GetEmployee } from '../auth/get-employee.decorator';
import type { AuthenticatedEmployee } from '../auth/employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { InchargeSessionsService } from './incharge-sessions.service';

// Status set mirrors the admin list endpoint — keeps the two surfaces in
// sync without re-declaring the union here.
const SessionStatusSchema = z.enum([
  'scheduled',
  'completed',
  'cancelled',
  'rescheduled',
]);

const ListSessionsQuerySchema = z
  .object({
    attendance_group_id: z.coerce.number().int().positive(),
    from: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    to: z.string().regex(DATE_RE, 'Use YYYY-MM-DD'),
    effective_employee_id: z.coerce.number().int().positive().optional(),
    status: z
      .union([SessionStatusSchema, z.array(SessionStatusSchema)])
      .optional(),
  })
  .strict()
  .refine((v) => v.to >= v.from, {
    message: 'to must not be before from',
    path: ['to'],
  });
class ListSessionsQueryDto extends createZodDto(ListSessionsQuerySchema) {}

/**
 * Live, day/week-of session management for an attendance group incharge.
 * Backs the "Schedule Management" side menu — cancel a class, assign an
 * alternate teacher, reschedule. Every endpoint is gated by group
 * ownership (see [[incharge-sessions.service.ts]]).
 *
 * The sibling [[incharge-schedule.controller.ts]] still owns template CUD
 * and the publish-week workflow. This controller is purely about acting on
 * already-published `class_sessions` rows.
 *
 * Action mapping per `timetable.incharge.schedule.manage`:
 *   - GET endpoints                   → `view`
 *   - cancel / uncancel / substitute / move → `edit`
 */
@ApiTags('incharge-sessions')
@ApiBearerAuth('employee-access-token')
@UseGuards(
  EmployeeJwtAuthGuard,
  RequireEmployeePasswordChangedGuard,
  ScreenAccessGuard,
)
@Controller('employee/attendance-incharge/sessions')
export class InchargeSessionsController {
  constructor(private readonly svc: InchargeSessionsService) {}

  @Get()
  @RequireScreen('timetable.incharge.schedule.manage', 'view')
  @ApiOperation({
    summary:
      'List sessions in a date window for one owned attendance group. Optional filters: teacher (effective_employee_id), status.',
  })
  list(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Query() query: ListSessionsQueryDto,
  ): Promise<ClassSession[]> {
    const status = query.status
      ? Array.isArray(query.status)
        ? query.status
        : [query.status]
      : undefined;
    return this.svc.list(
      employee.id,
      query.attendance_group_id,
      query.from,
      query.to,
      {
        effective_employee_id: query.effective_employee_id,
        status,
      },
    );
  }

  @Get(':id')
  @RequireScreen('timetable.incharge.schedule.manage', 'view')
  @ApiOperation({ summary: 'Fetch one session with full relations.' })
  getOne(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ClassSession> {
    return this.svc.getOne(employee.id, id);
  }

  @Get(':id/roster')
  @RequireScreen('timetable.incharge.schedule.manage', 'view')
  @ApiOperation({
    summary: 'Live-derived roster for one owned session.',
  })
  roster(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RosterStudent[]> {
    return this.svc.getRoster(employee.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.schedule.manage', 'edit')
  @ApiOperation({ summary: 'Cancel a scheduled session.' })
  cancel(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelSessionDto,
  ): Promise<ClassSession> {
    return this.svc.cancel(employee.id, id, dto);
  }

  @Post(':id/uncancel')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.schedule.manage', 'edit')
  @ApiOperation({ summary: 'Re-open a cancelled session (future dates only).' })
  uncancel(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UncancelSessionDto,
  ): Promise<ClassSession> {
    return this.svc.uncancel(employee.id, id, dto);
  }

  @Post(':id/substitute')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.schedule.manage', 'edit')
  @ApiOperation({
    summary:
      'Change the effective teacher (assign an alternate teacher / substitute).',
  })
  substitute(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubstituteSessionDto,
  ): Promise<ClassSession> {
    return this.svc.substitute(employee.id, id, dto);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @RequireScreen('timetable.incharge.schedule.manage', 'edit')
  @ApiOperation({
    summary:
      'Move a session to a new period and/or date — same group, no cell collisions.',
  })
  move(
    @GetEmployee() employee: AuthenticatedEmployee,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveSessionDto,
  ): Promise<ClassSession> {
    return this.svc.move(employee.id, id, dto);
  }
}
