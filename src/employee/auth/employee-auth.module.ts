import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { EmployeeGoogleOidcService } from './employee-google-oidc.service';
import { EmployeeJwtStrategy } from './employee-jwt.strategy';
import { RequireEmployeePasswordChangedGuard } from './require-password-changed.guard';
import { EmployeeCredential } from './entities/employee-credential.entity';
import { EmployeeAuthController } from './employee-auth.controller';
import { EmployeeAuthService } from './employee-auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Employee, EmployeeCredential]),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'employee-jwt' }),
    JwtModule.register({}),
  ],
  controllers: [EmployeeAuthController],
  providers: [
    EmployeeAuthService,
    EmployeeJwtStrategy,
    EmployeeGoogleOidcService,
    RequireEmployeePasswordChangedGuard,
  ],
  exports: [EmployeeAuthService],
})
export class EmployeeAuthModule {}
