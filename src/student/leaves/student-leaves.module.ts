import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceGroupIncharge } from '../../admin/entities/attendance-group-incharge.entity';
import { LeaveType } from '../../admin/entities/leave-type.entity';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { Student } from '../../admin/entities/student.entity';
import { StudentGroup } from '../../admin/entities/student-group.entity';
import { StudentLeave } from '../../leaves/entities/student-leave.entity';
import { RequestsModule } from '../../requests/requests.module';
import { LeaveApplyHandler } from './leave-apply.handler';
import { LeaveAttendanceSyncService } from './leave-attendance-sync.service';
import { LeaveCancelHandler } from './leave-cancel.handler';
import { StudentLeaveFileController } from './student-leave-file.controller';
import { StudentLeavesController } from './student-leaves.controller';
import { StudentLeavesService } from './student-leaves.service';

/**
 * Student leaves — owns the `student_leaves` row, the `/student/leaves`
 * surface, and the two request-type handlers (`leave_apply`, `leave_cancel`)
 * plugged into the approval-requests framework at boot.
 *
 * Deliberately imports neither AdminModule nor StudentModule (AdminModule →
 * StudentModule → this module would cycle); everything it needs is
 * repo-injected. StorageService and the notification services are @Global.
 * The read side attendance depends on lives in LeavesReadModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StudentLeave,
      LeaveType,
      Student,
      StudentGroup,
      AttendanceGroupIncharge,
      ProgrammeSemester,
    ]),
    RequestsModule,
  ],
  controllers: [StudentLeaveFileController, StudentLeavesController],
  providers: [
    StudentLeavesService,
    LeaveAttendanceSyncService,
    LeaveApplyHandler,
    LeaveCancelHandler,
  ],
})
export class StudentLeavesModule {}
