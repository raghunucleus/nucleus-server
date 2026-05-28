import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProgrammeSemester } from '../admin/entities/programme-semester.entity';
import { Student } from '../admin/entities/student.entity';
import { RequirePasswordChangedGuard } from './auth/require-password-changed.guard';
import { StudentGoogleOidcService } from './auth/student-google-oidc.service';
import { StudentJwtStrategy } from './auth/student-jwt.strategy';
import { StudentCredential } from './entities/student-credential.entity';
import { StudentAcademicsController } from './portal/student-academics.controller';
import { StudentPortalService } from './portal/student-portal.service';
import { StudentAuthController } from './student-auth.controller';
import { StudentAuthService } from './student-auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, StudentCredential, ProgrammeSemester]),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'student-jwt' }),
    JwtModule.register({}),
  ],
  controllers: [StudentAuthController, StudentAcademicsController],
  providers: [
    StudentAuthService,
    StudentJwtStrategy,
    StudentGoogleOidcService,
    RequirePasswordChangedGuard,
    StudentPortalService,
  ],
  exports: [StudentAuthService],
})
export class StudentModule {}
