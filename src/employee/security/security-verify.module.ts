import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { Student } from '../../admin/entities/student.entity';
import { RbacModule } from '../../rbac/rbac.module';
import { SecurityPassModule } from '../../security-pass/security-pass.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { SecurityVerifyController } from './security-verify.controller';
import { SecurityVerifyService } from './security-verify.service';

/**
 * Security-guard QR verification (`/employee/security/verify`). Gated by the
 * `security.verify.scan` RBAC screen (role type `security`). Consumes the
 * single-use security pass via `SecurityPassModule`, then looks up the holder
 * (Employee/Student) to confirm they are real and active. StorageService is
 * global (student photo presign).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, Student]),
    SecurityPassModule,
    EmployeeAuthModule,
    RbacModule,
  ],
  controllers: [SecurityVerifyController],
  providers: [SecurityVerifyService],
})
export class SecurityVerifyModule {}
