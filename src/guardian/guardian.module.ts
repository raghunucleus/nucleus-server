import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HolidaysReadModule } from '../holidays/holidays-read.module';
import { StudentModule } from '../student/student.module';
import { GuardianJwtStrategy } from './auth/guardian-jwt.strategy';
import { EmailOtpChannel } from './auth/otp-channel/email-otp.channel';
import { OTP_CHANNELS } from './auth/otp-channel/otp-channel.interface';
import { GuardianRequirePasswordChangedGuard } from './auth/require-password-changed.guard';
import { GuardianCredential } from './entities/guardian-credential.entity';
import { GuardianOtp } from './entities/guardian-otp.entity';
import { StudentGuardian } from './entities/student-guardian.entity';
import { GuardianAuthController } from './guardian-auth.controller';
import { GuardianAuthService } from './guardian-auth.service';
import { GuardianSyncService } from './guardian-sync.service';
import { GuardianAcademicsController } from './portal/guardian-academics.controller';
import { GuardianLinkGuard } from './portal/guardian-link.guard';
import { GuardianPortalService } from './portal/guardian-portal.service';
import { GuardianStudentsController } from './portal/guardian-students.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuardianCredential,
      StudentGuardian,
      GuardianOtp,
    ]),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'guardian-jwt' }),
    JwtModule.register({}),
    // Reused, student-scoped read services (timetable/attendance, exam
    // results) and the shared academic-calendar reads. forwardRef: the student
    // module imports THIS module back for GuardianSyncService (profile updates
    // mirror parent/guardian contacts into student_guardians).
    forwardRef(() => StudentModule),
    HolidaysReadModule,
  ],
  controllers: [
    GuardianAuthController,
    GuardianStudentsController,
    GuardianAcademicsController,
  ],
  providers: [
    GuardianAuthService,
    GuardianSyncService,
    GuardianJwtStrategy,
    GuardianRequirePasswordChangedGuard,
    GuardianPortalService,
    GuardianLinkGuard,
    EmailOtpChannel,
    {
      // The ordered list of active OTP channels. Email only for now; prepend
      // WhatsappOtpChannel here once its send() is implemented to make it the
      // primary channel (phone is always present).
      provide: OTP_CHANNELS,
      inject: [EmailOtpChannel],
      useFactory: (email: EmailOtpChannel) => [email],
    },
  ],
  exports: [GuardianAuthService, GuardianPortalService, GuardianSyncService],
})
export class GuardianModule {}
