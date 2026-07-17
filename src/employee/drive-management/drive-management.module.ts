import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '../../rbac/rbac.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { AdmissionYear } from '../../admin/entities/admission-year.entity';
import { Programme } from '../../admin/entities/programme.entity';
import { Company } from '../corporate-relations/entities/company.entity';
import { CompanyCategory } from '../corporate-relations/entities/company-lookups.entity';
import { DriveAttributesController } from './drive-attributes.controller';
import { DriveAttributesService } from './drive-attributes.service';
import { DrivesController } from './drives.controller';
import { DrivesService } from './drives.service';
import { Drive } from './entities/drive.entity';
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
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DriveDesignation,
      DriveJobLocation,
      DriveOfferType,
      DrivePlacementCategory,
      Drive,
      DriveEligibility,
      DriveProfile,
      DriveProfileAttachment,
      Company,
      CompanyCategory,
      Programme,
      AdmissionYear,
    ]),
    RbacModule,
    EmployeeAuthModule,
  ],
  controllers: [DriveAttributesController, DrivesController],
  providers: [DriveAttributesService, DrivesService],
})
export class DriveManagementModule {}
