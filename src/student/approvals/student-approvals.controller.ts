import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import { StudentListApprovalsDto } from './dto/list-approvals.dto';
import {
  StudentApprovalCounts,
  StudentApprovalItem,
  StudentApprovalsService,
} from './student-approvals.service';

/**
 * The student's Approvals inbox — everything sent to them for a decision plus
 * the history of what they already decided, filtered on the one common status
 * axis. Placement drive invites are the first source; future sources appear
 * here automatically once they upsert into `student_approvals`.
 *
 * The student id comes only from the JWT (`@GetStudent()`) — there is no id
 * parameter anywhere (student-API isolation contract).
 */
@ApiTags('student-approvals')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/approvals')
export class StudentApprovalsController {
  constructor(private readonly svc: StudentApprovalsService) {}

  @Get('counts')
  @ApiOperation({
    summary:
      "Count of the caller's approvals per common status — drives the status chips.",
  })
  counts(@GetStudent() s: AuthenticatedStudent): Promise<StudentApprovalCounts> {
    return this.svc.counts(s.id);
  }

  @Get()
  @ApiOperation({
    summary:
      "The caller's approvals, newest activity first, optionally narrowed by status/module.",
  })
  list(
    @GetStudent() s: AuthenticatedStudent,
    @Query() query: StudentListApprovalsDto,
  ): Promise<StudentApprovalItem[]> {
    return this.svc.list(s.id, query);
  }
}
