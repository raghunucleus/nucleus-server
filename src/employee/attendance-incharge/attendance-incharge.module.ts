import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../../admin/admin.module';
import { AttendanceGroup } from '../../admin/entities/attendance-group.entity';
import { ClassSession } from '../../admin/entities/class-session.entity';
import { ProgrammeSemester } from '../../admin/entities/programme-semester.entity';
import { Timetable } from '../../admin/entities/timetable.entity';
import { TimetableCourse } from '../../admin/entities/timetable-course.entity';
import { RbacModule } from '../../rbac/rbac.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { InchargeGroupsController } from './incharge-groups.controller';
import { InchargeScheduleController } from './incharge-schedule.controller';
import { InchargeScheduleService } from './incharge-schedule.service';
import { InchargeSessionsController } from './incharge-sessions.controller';
import { InchargeSessionsService } from './incharge-sessions.service';

/**
 * Schedule + template endpoints for an attendance group incharge. Authority
 * pivots on `attendance_groups.group_incharge_employee_id` — every read /
 * write is filtered by the groups the caller owns.
 *
 * Surface is split across two RBAC screens (one side-menu each):
 *   - `timetable.incharge.templates.manage` — template CUD, periods,
 *      courses, grid cells. Backed by `InchargeScheduleService` +
 *      `InchargeScheduleController` (still named `schedule.*` for URL
 *      stability; the controller serves both screens' template-side ops).
 *   - `timetable.incharge.schedule.manage`  — live operations: list
 *      sessions, cancel, uncancel, substitute, move. Backed by
 *      `InchargeSessionsService` + `InchargeSessionsController`.
 *
 * Both lean on AdminModule's canonical services (`TimetablesService`,
 * `SessionSeederService`, `ClassSessionsService`, `RosterService`) so we
 * keep a single implementation of the heavy logic and only add ownership
 * checks here. `forwardRef` is precautionary; AdminModule doesn't import
 * this module today.
 *
 * RBAC contract: every handler is paired with `@RequireScreen(...)` (or
 * `@RequireAnyScreen` for endpoints shared between the two screens) +
 * `ScreenAccessGuard`. See nucleus-server/CLAUDE.md.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AttendanceGroup,
      ClassSession,
      ProgrammeSemester,
      Timetable,
      TimetableCourse,
    ]),
    EmployeeAuthModule,
    RbacModule,
    forwardRef(() => AdminModule),
  ],
  controllers: [
    InchargeGroupsController,
    InchargeScheduleController,
    InchargeSessionsController,
  ],
  providers: [InchargeScheduleService, InchargeSessionsService],
})
export class AttendanceInchargeModule {}
