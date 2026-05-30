import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentNotification } from './entities/student-notification.entity';
import { StudentPushToken } from './entities/student-push-token.entity';
import { StudentNotificationsController } from './student-notifications.controller';
import { StudentNotificationsGateway } from './student-notification.gateway';
import { StudentNotificationService } from './student-notification.service';

/**
 * Student notification system: a global module so any student feature module
 * can inject `StudentNotificationService` and call `send(...)` without import
 * churn. Kept entirely separate from any future employee/parent notification
 * system (own entities, tables, gateway and tokens).
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([StudentNotification, StudentPushToken]),
    ConfigModule,
    // Verify-only: the gateway passes the student access secret explicitly per
    // call, mirroring the HTTP `student-jwt` strategy and the chat gateway.
    JwtModule.register({}),
  ],
  controllers: [StudentNotificationsController],
  providers: [StudentNotificationService, StudentNotificationsGateway],
  exports: [StudentNotificationService],
})
export class StudentNotificationModule {}
