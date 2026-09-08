import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { CreateStudentLeaveDto } from './dto/create-student-leave.dto';
import { ListStudentLeavesDto } from './dto/list-student-leaves.dto';
import { RequestLeaveCancelDto } from './dto/request-leave-cancel.dto';
import {
  LeaveContext,
  LeaveStatusCounts,
  StudentLeavesService,
  StudentLeaveView,
} from './student-leaves.service';

/**
 * The student "Leaves" module. Applications and cancellations are approval
 * requests (types `leave_apply` / `leave_cancel`) decided by the student's
 * attendance-group in-charges; this controller is the leave-shaped surface
 * over them. The student id comes only from the JWT (`@GetStudent()`).
 * Literal routes are declared before `:id` so they are never shadowed.
 */
@ApiTags('student-leaves')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/leaves')
export class StudentLeavesController {
  constructor(private readonly svc: StudentLeavesService) {}

  @Get('context')
  @ApiOperation({
    summary:
      'Form context: active leave types, the current semester window (for the out-of-range warning), your attendance group and its in-charges, and whether you can apply.',
  })
  context(@GetStudent() s: AuthenticatedStudent): Promise<LeaveContext> {
    return this.svc.context(s.id);
  }

  @Get('counts')
  @ApiOperation({
    summary: 'Count of your leaves per status — drives the chips.',
  })
  counts(@GetStudent() s: AuthenticatedStudent): Promise<LeaveStatusCounts> {
    return this.svc.counts(s.id);
  }

  @Get()
  @ApiOperation({ summary: 'Your leaves, newest first, optionally by status.' })
  list(
    @GetStudent() s: AuthenticatedStudent,
    @Query() q: ListStudentLeavesDto,
  ): Promise<StudentLeaveView[]> {
    return this.svc.list(s.id, q.status);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'One of your leaves with presigned attachment links and the linked request statuses. 404 if it is not yours.',
  })
  get(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StudentLeaveView> {
    return this.svc.getOne(s.id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Apply for leave. Goes to your attendance group’s in-charges for approval; 409 if the dates overlap an existing pending/approved leave.',
  })
  apply(
    @GetStudent() s: AuthenticatedStudent,
    @Body() dto: CreateStudentLeaveDto,
  ): Promise<StudentLeaveView> {
    return this.svc.apply(s.id, dto);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revise an application that was sent back to you and put it back in the queue. 409 unless it is currently sent back.',
  })
  resubmit(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStudentLeaveDto,
  ): Promise<StudentLeaveView> {
    return this.svc.resubmit(s.id, id, dto);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Withdraw the pending request on this leave — the application (leave becomes withdrawn) or the cancellation (leave stays approved).',
  })
  withdraw(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StudentLeaveView> {
    return this.svc.withdraw(s.id, id);
  }

  @Post(':id/cancel-request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Ask to cancel an approved leave. Goes to the same in-charges; the leave stays in effect until they approve.',
  })
  requestCancel(
    @GetStudent() s: AuthenticatedStudent,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequestLeaveCancelDto,
  ): Promise<StudentLeaveView> {
    return this.svc.requestCancel(s.id, id, dto.reason);
  }
}
