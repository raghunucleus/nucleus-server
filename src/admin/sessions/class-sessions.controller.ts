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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTotpEnrolledGuard } from '../auth/require-totp-enrolled.guard';
import { ListClassSessionsDto } from '../dto/list-class-sessions.dto';
import {
  CancelSessionDto,
  CreateAdHocSessionDto,
  MarkAttendanceDto,
  MoveSessionDto,
  SubstituteSessionDto,
  UncancelSessionDto,
} from '../dto/session-mutations.dto';
import { ClassSession } from '../entities/class-session.entity';
import {
  AttendanceMarkingService,
  type MarkResult,
} from './attendance-marking.service';
import { ClassSessionsService, type ActorContext } from './class-sessions.service';
import { RosterService, type RosterStudent } from './roster.service';

@ApiTags('class-sessions')
@ApiBearerAuth('admin-access-token')
@UseGuards(JwtAuthGuard, RequireTotpEnrolledGuard)
@Controller('admin/class-sessions')
export class ClassSessionsController {
  constructor(
    private readonly sessionsService: ClassSessionsService,
    private readonly rosterService: RosterService,
    private readonly markingService: AttendanceMarkingService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List sessions in a date window. Filter by programme_semester, attendance_group, teacher, or status.',
  })
  list(@Query() query: ListClassSessionsDto): Promise<ClassSession[]> {
    const status = query.status
      ? Array.isArray(query.status)
        ? query.status
        : [query.status]
      : undefined;
    return this.sessionsService.list({
      from: query.from,
      to: query.to,
      programme_semester_id: query.programme_semester_id,
      attendance_group_id: query.attendance_group_id,
      effective_employee_id: query.effective_employee_id,
      status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one session with all relations.' })
  getOne(@Param('id', ParseIntPipe) id: number): Promise<ClassSession> {
    return this.sessionsService.getOne(id);
  }

  @Get(':id/roster')
  @ApiOperation({
    summary:
      'Live-derived roster for the session — students currently in scope (handles transfers + electives).',
  })
  roster(@Param('id', ParseIntPipe) id: number): Promise<RosterStudent[]> {
    return this.rosterService.forSession(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a scheduled session.' })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelSessionDto,
    @Req() req: { user?: { id?: string | number } },
  ): Promise<ClassSession> {
    return this.sessionsService.cancel(id, dto, this.actor(req));
  }

  @Post(':id/uncancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-open a cancelled session (future dates only).' })
  uncancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UncancelSessionDto,
    @Req() req: { user?: { id?: string | number } },
  ): Promise<ClassSession> {
    return this.sessionsService.uncancel(id, dto, this.actor(req));
  }

  @Post(':id/substitute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the effective teacher (substitute).' })
  substitute(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubstituteSessionDto,
    @Req() req: { user?: { id?: string | number } },
  ): Promise<ClassSession> {
    return this.sessionsService.substitute(id, dto, this.actor(req));
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move a session to a new period and/or date.',
  })
  move(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveSessionDto,
    @Req() req: { user?: { id?: string | number } },
  ): Promise<ClassSession> {
    return this.sessionsService.move(id, dto, this.actor(req));
  }

  @Post('ad-hoc')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Insert an ad-hoc / makeup class not tied to a timetable cell.',
  })
  createAdHoc(
    @Body() dto: CreateAdHocSessionDto,
    @Req() req: { user?: { id?: string | number } },
  ): Promise<ClassSession> {
    return this.sessionsService.createAdHoc(dto, this.actor(req));
  }

  @Post(':id/mark-attendance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Mark or amend attendance for one session. allow_amend=true required to re-mark a completed session.',
  })
  markAttendance(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkAttendanceDto,
    @Req() req: { user?: { id?: string | number } },
  ): Promise<MarkResult> {
    return this.markingService.mark(id, dto, this.actor(req));
  }

  private actor(req: { user?: { id?: string | number } }): ActorContext {
    const adminId =
      req.user?.id !== undefined ? Number(req.user.id) : undefined;
    return { admin_id: adminId };
  }
}
