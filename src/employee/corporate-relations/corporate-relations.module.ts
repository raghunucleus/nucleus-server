import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Department } from '../../admin/entities/department.entity';
import { Employee } from '../../admin/entities/employee.entity';
import { RbacModule } from '../../rbac/rbac.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { DriveManagementModule } from '../drive-management/drive-management.module';
import { CompaniesController } from './companies.controller';
import { CompanyAttributesController } from './company-attributes.controller';
import { CompanyAttributesService } from './company-attributes.service';
import { CompanyManagementController } from './company-management.controller';
import { CorporateRelationsService } from './corporate-relations.service';
import { Company } from './entities/company.entity';
import { CompanyActivityLog } from './entities/company-activity-log.entity';
import { CompanyAttachment } from './entities/company-attachment.entity';
import { CompanyContact } from './entities/company-contact.entity';
import { CompanyInteraction } from './entities/company-interaction.entity';
import {
  CompanyCategory,
  CompanyHiringMode,
  CompanyIndustry,
  CompanyRole,
  CompanySize,
  CompanySource,
  CompanyTag,
  CompanyType,
} from './entities/company-lookups.entity';
import { CompanyRelationshipMilestone } from './entities/company-relationship-milestone.entity';

/**
 * Placement / corporate-relations role-type module — the company CRM. Holds the
 * manager surface (Company Management), the officer surface (Companies, scoped
 * to the responsible officer), and the lookup-configuration surface (Company
 * Attributes). Screens are declared in the RBAC catalog.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Company,
      CompanyActivityLog,
      CompanyContact,
      CompanyInteraction,
      CompanyRelationshipMilestone,
      CompanyAttachment,
      CompanyCategory,
      CompanyIndustry,
      CompanyType,
      CompanySize,
      CompanySource,
      CompanyHiringMode,
      CompanyRole,
      CompanyTag,
      Employee,
      Department,
    ]),
    RbacModule,
    EmployeeAuthModule,
    DriveManagementModule,
  ],
  controllers: [
    CompanyManagementController,
    CompaniesController,
    CompanyAttributesController,
  ],
  providers: [CorporateRelationsService, CompanyAttributesService],
})
export class CorporateRelationsModule {}
