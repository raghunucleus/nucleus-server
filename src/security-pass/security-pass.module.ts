import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SecurityPassService } from './security-pass.service';

/**
 * Issues and verifies single-use, short-lived security-pass tokens — the QR
 * rendered on student/employee ID cards and scanned by the security app. Redis
 * (global) enforces single-use; tokens are signed with `SECURITY_PASS_SECRET`.
 * Imported by the id-card modules (to issue) and the security-verify module
 * (to consume).
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [SecurityPassService],
  exports: [SecurityPassService],
})
export class SecurityPassModule {}
