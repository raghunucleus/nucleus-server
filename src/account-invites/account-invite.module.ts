import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../admin/entities/employee.entity';
import { Student } from '../admin/entities/student.entity';
import { EmployeeCredential } from '../employee/auth/entities/employee-credential.entity';
import { StudentCredential } from '../student/entities/student-credential.entity';
import { AccountInviteController } from './account-invite.controller';
import { AccountInviteService } from './account-invite.service';
import { AccountInvite } from './entities/account-invite.entity';

/**
 * Registers the credential entities directly rather than importing the two
 * auth modules: `AdminModule` imports those *and* this one, so depending on
 * them here would close a module cycle. MailModule and RedisModule are both
 * `@Global()`, so neither needs importing.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountInvite,
      Employee,
      EmployeeCredential,
      Student,
      StudentCredential,
    ]),
    ConfigModule,
  ],
  controllers: [AccountInviteController],
  providers: [AccountInviteService],
  exports: [AccountInviteService],
})
export class AccountInviteModule {}
