import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { Programme } from '../../admin/entities/programme.entity';
import { ApprovalApproversModule } from '../../approval-approvers/approval-approvers.module';
import { RbacModule } from '../../rbac/rbac.module';
import { RequestsModule } from '../../requests/requests.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import {
  DriveDesignation,
  DriveJobLocation,
} from '../drive-management/entities/drive-lookups.entity';
import { CompanyApprovalService } from './company-approval.service';
import { CompanyAttributesController } from './company-attributes.controller';
import { CompanyAttributesService } from './company-attributes.service';
import { CompanyManagementController } from './company-management.controller';
import { CorporateRelationsService } from './corporate-relations.service';
import { CrViewController } from './cr-view.controller';
import { CrViewService } from './cr-view.service';
import { Company } from './entities/company.entity';
import {
  CompanyCategory,
  CompanyCurrentStatus,
  CompanyRelationshipType,
} from './entities/company-lookups.entity';
import { CompanyJobRole } from './entities/company-job-role.entity';
import { CompanyJobRoleYear } from './entities/company-job-role-year.entity';
import { CompanyJobRoleYearContact } from './entities/company-job-role-year-contact.entity';
import { CompanyJobRoleYearStatusLog } from './entities/company-job-role-year-status-log.entity';
import { PassoutYear } from './entities/passout-year.entity';
import { JobRolesController } from './job-roles.controller';
import { PassoutYearsController } from './passout-years.controller';
import { PassoutYearsService } from './passout-years.service';

/**
 * Placement / corporate-relations role-type module — the company catalog. Holds
 * the management surface (Company Management), the lookup-configuration surface
 * (Company Attributes, which also hosts the passout-year master), the per-owner
 * surface (Roles or Designations — the roles one employee is accountable for,
 * plus adding a company), the per-owner-per-year surface (CR View — the same
 * roles with whatever was recorded against each passout year), and the
 * `company_approval` request type that gates every change to a company. Screens
 * are declared in the RBAC catalog.
 *
 * `RequestsModule` is imported one-way: the handler registers ITSELF into the
 * type registry at boot, so the framework never has to know this module exists.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Company,
      CompanyCategory,
      CompanyRelationshipType,
      CompanyCurrentStatus,
      CompanyJobRole,
      CompanyJobRoleYear,
      CompanyJobRoleYearContact,
      CompanyJobRoleYearStatusLog,
      PassoutYear,
      Employee,
      // CR View records reference the Drive Attributes and academics masters
      // (designations / job locations / programmes) and serves their pickers
      // from its own scope endpoint — entity registrations only, no service
      // dependency on the drive-management module.
      DriveDesignation,
      DriveJobLocation,
      Programme,
    ]),
    RbacModule,
    EmployeeAuthModule,
    RequestsModule,
    // Company Management shows a pending request inline and lets an approver
    // decide it there — so it has to ask whether the caller is one.
    ApprovalApproversModule,
  ],
  controllers: [
    CompanyManagementController,
    CompanyAttributesController,
    JobRolesController,
    CrViewController,
    PassoutYearsController,
  ],
  providers: [
    CorporateRelationsService,
    CompanyAttributesService,
    CompanyApprovalService,
    CrViewService,
    PassoutYearsService,
  ],
})
export class CorporateRelationsModule {}
