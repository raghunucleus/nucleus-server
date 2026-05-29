import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstitutionSetting } from '../admin/entities/institution-setting.entity';
import { ProgrammeSemester } from '../admin/entities/programme-semester.entity';
import { Student } from '../admin/entities/student.entity';
import { StudentGroup } from '../admin/entities/student-group.entity';
import { ChatModule } from './chat/chat.module';
import { RequirePasswordChangedGuard } from './auth/require-password-changed.guard';
import { StudentGoogleOidcService } from './auth/student-google-oidc.service';
import { StudentJwtStrategy } from './auth/student-jwt.strategy';
import { StudentCredential } from './entities/student-credential.entity';
import { StudentBirthdaysController } from './birthdays/student-birthdays.controller';
import { StudentBirthdaysService } from './birthdays/student-birthdays.service';
import { StudentIdCardController } from './id-card/student-id-card.controller';
import { StudentIdCardService } from './id-card/student-id-card.service';
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
    ]),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'student-jwt' }),
    JwtModule.register({}),
    ChatModule,
  ],
  controllers: [
    StudentAuthController,
    StudentAcademicsController,
    StudentIdCardController,
    StudentBirthdaysController,
  ],
  providers: [
    StudentAuthService,
    StudentJwtStrategy,
    StudentGoogleOidcService,
    RequirePasswordChangedGuard,
    StudentPortalService,
    StudentIdCardService,
    StudentBirthdaysService,
  ],
  exports: [StudentAuthService],
})
export class StudentModule {}
