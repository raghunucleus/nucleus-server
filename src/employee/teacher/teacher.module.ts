import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClassSession } from '../../admin/entities/class-session.entity';
import { ClassSessionAttendance } from '../../admin/entities/class-session-attendance.entity';
import { ClassSessionAuditLog } from '../../admin/entities/class-session-audit-log.entity';
import { Student } from '../../admin/entities/student.entity';
import { AttendanceMarkingService } from '../../admin/sessions/attendance-marking.service';
import { RosterService } from '../../admin/sessions/roster.service';
import { RbacModule } from '../../rbac/rbac.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { TeacherAttendanceController } from './teacher-attendance.controller';
import { TeacherAttendanceService } from './teacher-attendance.service';
import { TeacherTimetableController } from './teacher-timetable.controller';

/**
 * Teacher-specific endpoints (timetable view, marks entry, daily attendance)
 * land here. Each handler MUST follow the RBAC enforcement contract — see
 * nucleus-server/CLAUDE.md and [[hod.module.ts]] for the template.
 *
 * The attendance flow is intrinsically self-scoped — the teacher can only see
 * sessions where `effective_employee_id` is them — so the screens
 * `attendance.entry.daily` and `attendance.entry.history` carry no per-
 * attribute scope. The ScreenAccessGuard still gates access on the role
 * assignment; the service layer enforces ownership.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClassSession,
      ClassSessionAttendance,
      ClassSessionAuditLog,
      Student,
    ]),
    EmployeeAuthModule,
    RbacModule,
  ],
  controllers: [TeacherAttendanceController, TeacherTimetableController],
  providers: [
    TeacherAttendanceService,
    RosterService,
    AttendanceMarkingService,
  ],
})
export class TeacherModule {}
