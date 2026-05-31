import { Module } from '@nestjs/common';
import { HolidaysReadModule } from '../../holidays/holidays-read.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { EmployeeHolidaysController } from './employee-holidays.controller';

/**
 * Cross-role employee endpoints that every authenticated employee can reach
 * regardless of their RBAC role assignment — currently the read-only academic
 * calendar. Role-specific surfaces stay in their own role modules.
 */
@Module({
  imports: [EmployeeAuthModule, HolidaysReadModule],
  controllers: [EmployeeHolidaysController],
})
export class EmployeeCommonModule {}
