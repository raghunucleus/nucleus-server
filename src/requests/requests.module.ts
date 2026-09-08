import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceGroupIncharge } from '../admin/entities/attendance-group-incharge.entity';
import { Employee } from '../admin/entities/employee.entity';
import { ProgrammeAdmissionYear } from '../admin/entities/programme-admission-year.entity';
import { ProgrammeAdmissionYearProfileVerifier } from '../admin/entities/programme-admission-year-profile-verifier.entity';
import { Student } from '../admin/entities/student.entity';
import { StudentGroup } from '../admin/entities/student-group.entity';
import { ApprovalApproversModule } from '../approval-approvers/approval-approvers.module';
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
 * lifecycle/state, duplicate serialization, routing (batch verifiers or
 * attendance-group in-charges for student requests, action approvers for
 * employee ones), decisions, the My Requests / Approvals surfaces, requester
 * notifications.
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
      Employee,
      ProgrammeAdmissionYear,
      ProgrammeAdmissionYearProfileVerifier,
      // Attendance-group routing: the student's current group (student_groups)
      // and that group's in-charges. Repo-injected, never AdminModule.
      AttendanceGroupIncharge,
      StudentGroup,
    ]),
    RbacModule,
    EmployeeAuthModule,
    // Employee-raised requests route by action key. No cycle: that module
    // imports TypeORM + RbacModule only, never this one.
    ApprovalApproversModule,
  ],
  controllers: [StudentRequestsController, EmployeeRequestsController],
  providers: [ApprovalRequestsService, RequestTypeRegistry],
  exports: [ApprovalRequestsService, RequestTypeRegistry],
})
export class RequestsModule {}
