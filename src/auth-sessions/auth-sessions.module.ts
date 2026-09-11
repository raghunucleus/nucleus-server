import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthSession } from './auth-session.entity';
import { AuthSessionsCleanupService } from './auth-sessions-cleanup.service';
import { AuthSessionsService } from './auth-sessions.service';
import { DeviceLimitChallengeService } from './device-limit-challenge.service';
import { SessionSocketRegistry } from './session-socket-registry';

/**
 * Login sessions for students, employees and parents (see
 * {@link AuthSessionsService}). Global and dependent only on TypeORM, Redis
 * and config, so every credential-changing caller — the three auth services,
 * account invites, admin, guardian sync — and every socket gateway can inject
 * it without creating a module cycle.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuthSession])],
  providers: [
    AuthSessionsService,
    SessionSocketRegistry,
    DeviceLimitChallengeService,
    AuthSessionsCleanupService,
  ],
  exports: [
    AuthSessionsService,
    SessionSocketRegistry,
    DeviceLimitChallengeService,
  ],
})
export class AuthSessionsModule {}
