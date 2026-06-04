import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProgrammeAdmissionYear } from '../../admin/entities/programme-admission-year.entity';
import { Student } from '../../admin/entities/student.entity';
import { RbacModule } from '../../rbac/rbac.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { StudentCgpa } from '../exam-marks/entities/student-cgpa.entity';
import { StudentExamResult } from '../exam-marks/entities/student-exam-result.entity';
import { StudentExamResultStaging } from '../exam-marks/entities/student-exam-result-staging.entity';
import { StudentSemesterGpa } from '../exam-marks/entities/student-semester-gpa.entity';
import { ExamMarksController } from '../exam-marks/exam-marks.controller';
import { StudentMarksController } from '../exam-marks/student-marks.controller';
import { ExamMarksService } from '../exam-marks/exam-marks.service';

/**
 * Exam Cell role-type module. Holds exam-cell-specific controllers and
 * services (marks upload today; mark structures / results as they land). The
 * screens this role can be granted are declared in the RBAC catalog
 * (src/rbac/catalog/screens.ts).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProgrammeAdmissionYear,
      Student,
      StudentExamResult,
      StudentSemesterGpa,
      StudentCgpa,
      StudentExamResultStaging,
    ]),
    RbacModule,
    EmployeeAuthModule,
  ],
  controllers: [ExamMarksController, StudentMarksController],
  providers: [ExamMarksService],
})
// StudentNotificationService is provided by the @Global StudentNotificationModule,
// so ExamMarksService can inject it without importing anything here.
export class ExamCellModule {}
