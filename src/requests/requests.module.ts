import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProgrammeAdmissionYear } from '../admin/entities/programme-admission-year.entity';
import { ProgrammeAdmissionYearProfileVerifier } from '../admin/entities/programme-admission-year-profile-verifier.entity';
import { Student } from '../admin/entities/student.entity';
import { EmployeeAuthModule } from '../employee/auth/employee-auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { ApprovalRequestsService } from './approval-requests.service';
import { EmployeeRequestsController } from './employee-requests.controller';
import { ApprovalRequestEvent } from './entities/approval-request-event.entity';
import { ApprovalRequest } from './entities/approval-request.entity';
import { RequestTypeRegistry } from './request-type.registry';
import { StudentRequestsController } from './student-requests.controller';

/**
 * Generic approval-requests framework — the COMMON layer only: request
 * lifecycle/state, one-pending-per-type, verifier routing, decisions,
 * the My Requests / Approvals surfaces, requester notifications.
 *
 * Everything type-specific lives with the type's own module, plugged in via
 * {@link RequestTypeRegistry} (e.g. the student-profile module owns the
 * `profile_update` type: its DTO validation, value snapshotting, and applying
 * the changes on approve). Adding a new request type touches only that
 * module — never this one.
 *
 * Student guards resolve without importing StudentModule (passport strategies
 * are app-wide; precedent: StudentNotificationsController) and
 * StudentNotificationService comes from the @Global notification module.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalRequest,
      ApprovalRequestEvent,
      Student,
      ProgrammeAdmissionYear,
      ProgrammeAdmissionYearProfileVerifier,
    ]),
    RbacModule,
    EmployeeAuthModule,
  ],
  controllers: [StudentRequestsController, EmployeeRequestsController],
  providers: [ApprovalRequestsService, RequestTypeRegistry],
  exports: [ApprovalRequestsService, RequestTypeRegistry],
})
export class RequestsModule {}
