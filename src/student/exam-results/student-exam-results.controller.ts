import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetStudent } from '../auth/get-student.decorator';
import { RequirePasswordChangedGuard } from '../auth/require-password-changed.guard';
import { StudentJwtAuthGuard } from '../auth/student-jwt-auth.guard';
import type { AuthenticatedStudent } from '../auth/student-jwt.strategy';
import {
  StudentExamResultsService,
  StudentExamResultsView,
} from './student-exam-results.service';

@ApiTags('student-exam-results')
@ApiBearerAuth('student-access-token')
@UseGuards(StudentJwtAuthGuard, RequirePasswordChangedGuard)
@Controller('student/exam-results')
export class StudentExamResultsController {
  constructor(private readonly svc: StudentExamResultsService) {}

  @Get()
  @ApiOperation({
    summary:
      "The signed-in student's own exam results: cached CGPA, per-semester " +
      'SGPA + pass/fail, and the best-attempt subject grades. Always scoped to ' +
      'the caller — there is no id parameter.',
  })
  myResults(
    @GetStudent() student: AuthenticatedStudent,
  ): Promise<StudentExamResultsView> {
    return this.svc.myResults(student.id);
  }
}
