import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Country } from '../admin/entities/country.entity';
import { DiplomaBoard } from '../admin/entities/diploma-board.entity';
import { District } from '../admin/entities/district.entity';
import { EntranceExam } from '../admin/entities/entrance-exam.entity';
import { IndustryCertification } from '../admin/entities/industry-certification.entity';
import { InstitutionSetting } from '../admin/entities/institution-setting.entity';
import { ProgrammeSemester } from '../admin/entities/programme-semester.entity';
import { SchoolBoardX } from '../admin/entities/school-board-x.entity';
import { SchoolBoardXii } from '../admin/entities/school-board-xii.entity';
import { State } from '../admin/entities/state.entity';
import { Student } from '../admin/entities/student.entity';
import { StudentGroup } from '../admin/entities/student-group.entity';
import { StudentIndustryCertification } from '../admin/entities/student-industry-certification.entity';
import { GuardianModule } from '../guardian/guardian.module';
import { StudentCgpa } from '../employee/exam-marks/entities/student-cgpa.entity';
import { StudentExamResult } from '../employee/exam-marks/entities/student-exam-result.entity';
import { StudentSemesterGpa } from '../employee/exam-marks/entities/student-semester-gpa.entity';
import { HolidaysReadModule } from '../holidays/holidays-read.module';
import { RequestsModule } from '../requests/requests.module';
import { SecurityPassModule } from '../security-pass/security-pass.module';
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
import { StudentLookupsController } from './lookups/student-lookups.controller';
import { StudentLookupsService } from './lookups/student-lookups.service';
import { StudentEmailOtp } from './profile/entities/student-email-otp.entity';
import { PersonalEmailController } from './profile/personal-email.controller';
import { PersonalEmailService } from './profile/personal-email.service';
import { PublicResumeController } from './profile/public-resume.controller';
import { ProfileUpdateRequestController } from './profile/profile-update-request.controller';
import { ProfileUpdateRequestService } from './profile/profile-update-request.service';
import { StudentCertificateFileController } from './profile/student-certificate-file.controller';
import { StudentFullProfileController } from './profile/student-full-profile.controller';
import { StudentFullProfileService } from './profile/student-full-profile.service';
import { StudentPhotoController } from './profile/student-photo.controller';
import { StudentPhotoService } from './profile/student-photo.service';
import { StudentProfileController } from './profile/student-profile.controller';
import { StudentProfileService } from './profile/student-profile.service';
import { StudentResumeController } from './profile/student-resume.controller';
import { StudentResumeService } from './profile/student-resume.service';
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
      StudentEmailOtp,
      StudentIndustryCertification,
      // Lookup masters served read-only to the profile dropdown endpoints.
      Country,
      State,
      District,
      EntranceExam,
      IndustryCertification,
      SchoolBoardX,
      SchoolBoardXii,
      DiplomaBoard,
    ]),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'student-jwt' }),
    JwtModule.register({}),
    ChatModule,
    HolidaysReadModule,
    SecurityPassModule,
    // The profile-update request type plugs into the approval-requests
    // framework: this module owns the fields, the framework owns the lifecycle.
    RequestsModule,
    // Approved parent/guardian profile fields mirror into student_guardians
    // via GuardianSyncService. forwardRef: the guardian module already imports
    // this one for the student-scoped portal read services.
    forwardRef(() => GuardianModule),
  ],
  controllers: [
    StudentAuthController,
    StudentAcademicsController,
    StudentIdCardController,
    StudentBirthdaysController,
    StudentHolidaysController,
    StudentExamResultsController,
    StudentProfileController,
    StudentFullProfileController,
    StudentPhotoController,
    StudentResumeController,
    PublicResumeController,
    StudentCertificateFileController,
    PersonalEmailController,
    StudentLookupsController,
    ProfileUpdateRequestController,
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
    StudentProfileService,
    StudentFullProfileService,
    StudentPhotoService,
    StudentResumeService,
    PersonalEmailService,
    StudentLookupsService,
    ProfileUpdateRequestService,
  ],
  exports: [
    StudentAuthService,
    // Surfaced so the guardian (parent) portal can reuse the exact same
    // student-scoped read logic, gated by its own guardian↔student link check.
    StudentPortalService,
    StudentExamResultsService,
    // Reused by the admin students module (admin resume upload/remove).
    StudentResumeService,
  ],
})
export class StudentModule {}
