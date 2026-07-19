import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '../../rbac/rbac.module';
import { StudentApprovalsModule } from '../../student/approvals/student-approvals.module';
import { StudentQueryModule } from '../../student-query/student-query.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { ExportsModule } from '../exports/exports.module';
import { AdmissionYear } from '../../admin/entities/admission-year.entity';
import { Programme } from '../../admin/entities/programme.entity';
import { Student } from '../../admin/entities/student.entity';
import { Company } from '../corporate-relations/entities/company.entity';
import { CompanyCategory } from '../corporate-relations/entities/company-lookups.entity';
import { DriveAnalyticsController } from './drive-analytics.controller';
import { DriveAnalyticsService } from './drive-analytics.service';
import { DriveAttributesController } from './drive-attributes.controller';
import { DriveAttributesService } from './drive-attributes.service';
import { DriveAutoRejectService } from './drive-auto-reject.service';
import { DriveStudentProfileService } from './drive-student-profile.service';
import { DriveStudentsController } from './drive-students.controller';
import { DriveStudentsService } from './drive-students.service';
import { DriveStudentsSearchController } from './drive-students-search.controller';
import { DriveStudentsSearchService } from './drive-students-search.service';
import { DrivesController } from './drives.controller';
import { DrivesService } from './drives.service';
import { EligibilityCheckController } from './eligibility-check.controller';
import { EligibilityCheckService } from './eligibility-check.service';
import { PlacementCoordinatorDrivesController } from './placement-coordinator-drives.controller';
import { PlacementCoordinatorDrivesService } from './placement-coordinator-drives.service';
import { Drive } from './entities/drive.entity';
import { DriveStatusEvent } from './entities/drive-status-event.entity';
import { DriveStudent } from './entities/drive-student.entity';
import { DriveStudentEvent } from './entities/drive-student-event.entity';
import { DriveEligibility } from './entities/drive-eligibility.entity';
import { DriveProfile } from './entities/drive-profile.entity';
import { DriveProfileAttachment } from './entities/drive-profile-attachment.entity';
import {
  DriveDesignation,
  DriveJobLocation,
  DriveOfferType,
  DrivePlacementCategory,
} from './entities/drive-lookups.entity';

/**
 * Placement drives module — the Drive Attributes lookup-configuration surface
 * and the drives themselves. Screens are declared in the RBAC catalog.
 *
 * `Company` / `CompanyCategory` are registered read-only here so a drive can
 * resolve its company and seed its categories from the CRM's classification;
 * writes to those tables stay in the corporate-relations module. `Programme` /
 * `AdmissionYear` are likewise read-only — the eligibility form offers programmes
 * and derives the passout-year options from admission years (year + 4).
 * `Student` is read-only too — the Students tab's detail sheet reads the full
 * profile; every student write lives in the admin/student modules.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DriveDesignation,
      DriveJobLocation,
      DriveOfferType,
      DrivePlacementCategory,
      Drive,
      DriveStatusEvent,
      DriveStudent,
      DriveStudentEvent,
      DriveEligibility,
      DriveProfile,
      DriveProfileAttachment,
      Company,
      CompanyCategory,
      Programme,
      AdmissionYear,
      Student,
    ]),
    RbacModule,
    EmployeeAuthModule,
    StudentQueryModule,
    ExportsModule,
    StudentApprovalsModule,
  ],
  controllers: [
    DriveAttributesController,
    DrivesController,
    DriveStudentsSearchController,
    DriveStudentsController,
    DriveAnalyticsController,
    EligibilityCheckController,
    PlacementCoordinatorDrivesController,
  ],
  providers: [
    DriveAttributesService,
    DrivesService,
    DriveStudentsSearchService,
    DriveStudentProfileService,
    DriveStudentsService,
    DriveAutoRejectService,
    DriveAnalyticsService,
    EligibilityCheckService,
    PlacementCoordinatorDrivesService,
  ],
  // DrivesService is consumed by the student-facing StudentPlacementsModule
  // (drive detail for an invited student). Writes stay employee-side.
  exports: [DrivesService],
})
export class DriveManagementModule {}
