import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthSession } from './auth-session.entity';
import { SESSION_RETENTION_DAYS } from './session.constants';

const BATCH_SIZE = 5000;

/**
 * Ages out `auth_sessions` rows {@link SESSION_RETENTION_DAYS} past their
 * `expires_at`. Revoked rows stop rolling `expires_at` forward, so they leave
 * on the same clock; live sessions keep sliding and are never touched.
 */
@Injectable()
export class AuthSessionsCleanupService {
  private readonly logger = new Logger('AuthSessionsCleanup');

  constructor(
    @InjectRepository(AuthSession)
    private readonly sessions: Repository<AuthSession>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(
      Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    let deleted = 0;
    // DELETE ... LIMIT isn't valid in Postgres, so delete by a bounded id set
    // and loop until a batch comes back smaller than the cap.
    for (;;) {
      const res: { affected?: number | null } = await this.sessions
        .createQueryBuilder()
        .delete()
        .where(
          'id IN (SELECT id FROM "auth_sessions" WHERE expires_at < :cutoff LIMIT :batch)',
          { cutoff, batch: BATCH_SIZE },
        )
        .execute();
      const n = res.affected ?? 0;
      deleted += n;
      if (n < BATCH_SIZE) break;
    }

    if (deleted > 0) {
      this.logger.log(`Purged ${deleted} expired auth session row(s).`);
    }
    return deleted;
  }
}
