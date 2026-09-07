import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceGroup } from '../../admin/entities/attendance-group.entity';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { RbacModule } from '../../rbac/rbac.module';
import { AttendanceInchargeModule } from '../attendance-incharge/attendance-incharge.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { AttendanceAnalyticsController } from './attendance-analytics.controller';
import { AttendanceAnalyticsService } from './attendance-analytics.service';

/**
 * Read-only attendance analytics for an attendance-group incharge — the
 * `attendance.incharge.analytics.view` screen.
 *
 * Sits beside `AttendanceInchargeModule` rather than inside it because it is a
 * separate menu item under a different catalog module (`attendance`, not
 * `timetable`) on its own base path, and its query surface is large enough to
 * warrant its own home. It imports that module purely for
 * `InchargeScheduleService`, so ownership resolution
 * (`ownedGroupIds` / `listGroups` / `listProgrammeSemesters`) has exactly one
 * implementation across both surfaces.
 *
 * `AdminModule` is deliberately NOT imported: everything here is aggregate SQL
 * over `class_sessions` / `class_session_attendance` / `student_subject_attendance`,
 * and pulling in the admin services would drag the session seeder and student
 * notification stack behind it. The one thing borrowed from admin is the
 * `pct()` helper, imported directly so both surfaces round identically.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AttendanceGroup, ProgrammeSemester]),
    EmployeeAuthModule,
    RbacModule,
    AttendanceInchargeModule,
  ],
  controllers: [AttendanceAnalyticsController],
  providers: [AttendanceAnalyticsService],
})
export class AttendanceAnalyticsModule {}
