import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { JwtStrategy } from './auth/jwt.strategy';
import { RequireTotpEnrolledGuard } from './auth/require-totp-enrolled.guard';
import { TotpService } from './auth/totp.service';
import { AdminRecoveryCode } from './entities/admin-recovery-code.entity';
import { Admin } from './entities/admin.entity';
import { MigrationsController } from './migrations/migrations.controller';
import { MigrationsService } from './migrations/migrations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Admin, AdminRecoveryCode]),
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'admin-jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AdminController, MigrationsController],
  providers: [
    AdminService,
    JwtStrategy,
    MigrationsService,
    TotpService,
    RequireTotpEnrolledGuard,
  ],
  exports: [AdminService],
})
export class AdminModule {}
