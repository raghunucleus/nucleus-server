import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { InstitutionSetting } from '../../admin/entities/institution-setting.entity';
import { RbacModule } from '../../rbac/rbac.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { EmployeeIdCardController } from './employee-id-card.controller';
import { EmployeeIdCardService } from './employee-id-card.service';

/**
 * Digital ID card for the signed-in employee. Gated by the
 * `employee.id_card.view` RBAC screen (`ScreenAccessGuard` + `@RequireScreen`);
 * the employee is always derived from the JWT, never the request. The QR is a
 * non-expiring HMAC-signed code (no JWT) so a future security app can verify it
 * offline with the shared `JWT_ID_CARD_SECRET`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, InstitutionSetting]),
    EmployeeAuthModule,
    RbacModule,
  ],
  controllers: [EmployeeIdCardController],
  providers: [EmployeeIdCardService],
})
export class EmployeeIdCardModule {}
