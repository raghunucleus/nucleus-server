import { Module } from '@nestjs/common';

import { AccountantModule } from './accountant/accountant.module';
import { AttendanceInchargeModule } from './attendance-incharge/attendance-incharge.module';
import { EmployeeAuthModule } from './auth/employee-auth.module';
import { CashierModule } from './cashier/cashier.module';
import { ExamCellModule } from './exam-cell/exam-cell.module';
import { HodModule } from './hod/hod.module';
import { ManagementModule } from './management/management.module';
import { PrincipalModule } from './principal/principal.module';
import { TeacherModule } from './teacher/teacher.module';

/**
 * Aggregates everything employee-facing on the server: the auth subsystem
 * (`/employee/auth/*`) plus one sub-module per functional role type from the
 * RBAC catalog (see src/rbac/catalog/role-types.ts). Role-type sub-modules
 * are stubbed today and will hold the controllers/services specific to each
 * role's responsibilities as those features land.
 *
 * Auth is re-exported so other modules (admin's employees service, RBAC)
 * can pull in `EmployeeAuthModule` via `EmployeeModule` without having to
 * know the directory layout.
 */
@Module({
  imports: [
    EmployeeAuthModule,
    HodModule,
    TeacherModule,
    ExamCellModule,
    ManagementModule,
    PrincipalModule,
    AccountantModule,
    CashierModule,
    AttendanceInchargeModule,
  ],
  exports: [EmployeeAuthModule],
})
export class EmployeeModule {}
