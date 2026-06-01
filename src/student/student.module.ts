import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstitutionSetting } from '../admin/entities/institution-setting.entity';
import { ProgrammeSemester } from '../admin/entities/programme-semester.entity';
import { Student } from '../admin/entities/student.entity';
import { StudentGroup } from '../admin/entities/student-group.entity';
import { StudentCgpa } from '../employee/exam-marks/entities/student-cgpa.entity';
import { StudentExamResult } from '../employee/exam-marks/entities/student-exam-result.entity';
import { StudentSemesterGpa } from '../employee/exam-marks/entities/student-semester-gpa.entity';
import { HolidaysReadModule } from '../holidays/holidays-read.module';
import { ChatModule } from './chat/chat.module';
import { RequirePasswordChangedGuard } from './auth/require-password-changed.guard';
import { StudentGoogleOidcService } from './auth/student-google-oidc.service';
import { StudentJwtStrategy } from './auth/student-jwt.strategy';
import { StudentCredential } from './entities/student-credential.entity';
import { StudentBirthdaysController } from './birthdays/student-birthdays.controller';
import { StudentBirthdaysService } from './birthdays/student-birthdays.service';
import { StudentHolidaysController } from './holidays/student-holidays.controller';
import { StudentIdCardController } from './id-card/student-id-card.controller';
import { StudentIdCardService } from './id-card/student-id-card.service';
import { StudentExamResultsController } from './exam-results/student-exam-results.controller';
import { StudentExamResultsService } from './exam-results/student-exam-results.service';
import { StudentAcademicsController } from './portal/student-academics.controller';
import { StudentPortalService } from './portal/student-portal.service';
import { StudentAuthController } from './student-auth.controller';
import { StudentAuthService } from './student-auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Student,
      StudentCredential,
      ProgrammeSemester,
      StudentGroup,
      InstitutionSetting,
      StudentCgpa,
      StudentSemesterGpa,
      StudentExamResult,
    ]),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'student-jwt' }),
    JwtModule.register({}),
    ChatModule,
    HolidaysReadModule,
  ],
  controllers: [
    StudentAuthController,
    StudentAcademicsController,
    StudentIdCardController,
    StudentBirthdaysController,
    StudentHolidaysController,
    StudentExamResultsController,
  ],
  providers: [
    StudentAuthService,
    StudentJwtStrategy,
    StudentGoogleOidcService,
    RequirePasswordChangedGuard,
    StudentPortalService,
    StudentIdCardService,
    StudentBirthdaysService,
    StudentExamResultsService,
  ],
  exports: [
    StudentAuthService,
    // Surfaced so the guardian (parent) portal can reuse the exact same
    // student-scoped read logic, gated by its own guardian↔student link check.
    StudentPortalService,
    StudentExamResultsService,
  ],
})
export class StudentModule {}
