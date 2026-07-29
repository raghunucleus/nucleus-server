import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { ApprovalApproversModule } from '../../approval-approvers/approval-approvers.module';
import { RbacModule } from '../../rbac/rbac.module';
import { RequestsModule } from '../../requests/requests.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { CompanyApprovalService } from './company-approval.service';
import { CompanyAttributesController } from './company-attributes.controller';
import { CompanyAttributesService } from './company-attributes.service';
import { CompanyManagementController } from './company-management.controller';
import { CorporateRelationsService } from './corporate-relations.service';
import { Company } from './entities/company.entity';
import { CompanyCategory } from './entities/company-lookups.entity';
import { CompanyJobRole } from './entities/company-job-role.entity';

/**
 * Placement / corporate-relations role-type module — the company catalog. Holds
 * the management surface (Company Management), the lookup-configuration surface
 * (Company Attributes), and the `company_approval` request type that gates
 * every change to a company. Screens are declared in the RBAC catalog.
 *
 * `RequestsModule` is imported one-way: the handler registers ITSELF into the
 * type registry at boot, so the framework never has to know this module exists.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Company,
      CompanyCategory,
      CompanyJobRole,
      Employee,
    ]),
    RbacModule,
    EmployeeAuthModule,
    RequestsModule,
    // Company Management shows a pending request inline and lets an approver
    // decide it there — so it has to ask whether the caller is one.
    ApprovalApproversModule,
  ],
  controllers: [CompanyManagementController, CompanyAttributesController],
  providers: [
    CorporateRelationsService,
    CompanyAttributesService,
    CompanyApprovalService,
  ],
})
export class CorporateRelationsModule {}
