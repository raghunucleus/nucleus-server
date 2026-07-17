import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { EmployeeNotificationPreference } from './entities/employee-notification-preference.entity';
import { EmployeeNotification } from './entities/employee-notification.entity';
import { EmployeePushToken } from './entities/employee-push-token.entity';
import { EmployeeNotificationsController } from './employee-notifications.controller';
import { EmployeeNotificationsGateway } from './employee-notification.gateway';
import { EmployeeNotificationService } from './employee-notification.service';

/**
 * Employee notification system: a global module so any feature module can
 * inject `EmployeeNotificationService` and call `send(...)` without import
 * churn. Kept entirely separate from the student notification system (own
 * entities, tables, gateway, tokens and JWT secret).
 *
 * MailService comes from the global MailModule, so email needs no import here.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmployeeNotification,
      EmployeePushToken,
      EmployeeNotificationPreference,
      Employee,
    ]),
    ConfigModule,
    // Verify-only: the gateway passes the employee access secret explicitly per
    // call, mirroring the HTTP `employee-jwt` strategy.
    JwtModule.register({}),
  ],
  controllers: [EmployeeNotificationsController],
  providers: [EmployeeNotificationService, EmployeeNotificationsGateway],
  exports: [EmployeeNotificationService],
})
export class EmployeeNotificationModule {}
