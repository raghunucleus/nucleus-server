import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { RbacModule } from '../../rbac/rbac.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { EmployeeBirthdaysController } from './employee-birthdays.controller';
import { EmployeeBirthdaysService } from './employee-birthdays.service';

/**
 * Colleague birthdays for the signed-in employee, scoped to their own
 * department. Gated by the `employee.birthdays.view` RBAC screen
 * (`ScreenAccessGuard` + `@RequireScreen`); the department cohort is derived
 * server-side from the JWT, never from the request.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Employee]),
    EmployeeAuthModule,
    RbacModule,
  ],
  controllers: [EmployeeBirthdaysController],
  providers: [EmployeeBirthdaysService],
})
export class EmployeeBirthdaysModule {}
