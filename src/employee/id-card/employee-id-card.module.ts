import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { InstitutionSetting } from '../../admin/entities/institution-setting.entity';
import { RbacModule } from '../../rbac/rbac.module';
import { SecurityPassModule } from '../../security-pass/security-pass.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { EmployeeIdCardController } from './employee-id-card.controller';
import { EmployeeIdCardService } from './employee-id-card.service';

/**
 * Digital ID card for the signed-in employee. Gated by the
 * `employee.id_card.view` RBAC screen (`ScreenAccessGuard` + `@RequireScreen`);
 * the employee is always derived from the JWT, never the request. The QR is a
 * single-use, short-lived security pass (see `SecurityPassModule`) that the
 * security app verifies and the client rotates on expiry.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, InstitutionSetting]),
    EmployeeAuthModule,
    RbacModule,
    SecurityPassModule,
  ],
  controllers: [EmployeeIdCardController],
  providers: [EmployeeIdCardService],
})
export class EmployeeIdCardModule {}
