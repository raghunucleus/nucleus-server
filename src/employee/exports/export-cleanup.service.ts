import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { StorageService } from '../../storage/storage.service';
import { ExportJob } from './entities/export-job.entity';

/** pending/processing rows older than this are considered orphaned. */
const STALE_ACTIVE_MS = 30 * 60 * 1000;
/** expired/failed rows are purged after this long. */
const PURGE_AFTER_DAYS = 30;
const PURGE_BATCH = 1000;

/**
 * Enforces the export retention contract. Hourly:
 * 1. `ready` rows past `expires_at` → delete the object from the bucket, flip
 *    the row to `expired` (the row survives so a late click gets a precise
 *    "this export has expired" instead of a dead link).
 * 2. `pending`/`processing` rows untouched for 30+ minutes → `failed`. There
 *    is no durable queue — a server restart mid-generation orphans the row,
 *    and this sweep is the recovery path.
 * 3. `expired`/`failed` rows older than 30 days → purged.
 */
@Injectable()
export class ExportCleanupService {
  private readonly logger = new Logger('ExportCleanup');

  constructor(
    @InjectRepository(ExportJob)
    private readonly jobs: Repository<ExportJob>,
    private readonly storage: StorageService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const now = new Date();

    const toExpire = await this.jobs.find({
      where: { status: 'ready', expires_at: LessThan(now) },
    });
    for (const job of toExpire) {
      if (job.storage_key) {
        await this.storage.deleteObject(job.storage_key);
      }
      await this.jobs.update(job.id, { status: 'expired' });
    }
    if (toExpire.length > 0) {
      this.logger.log(`Expired ${toExpire.length} export file(s).`);
    }

    const staleCutoff = new Date(Date.now() - STALE_ACTIVE_MS);
    const stale = await this.jobs
      .createQueryBuilder()
      .update()
      .set({
        status: 'failed',
        error: 'Interrupted (server restart during export).',
      })
      .where('status IN (:...statuses)', { statuses: ['pending', 'processing'] })
      .andWhere('updated_at < :cutoff', { cutoff: staleCutoff })
      .execute();
    if ((stale.affected ?? 0) > 0) {
      this.logger.warn(`Failed ${stale.affected} orphaned export job(s).`);
    }

    const purgeCutoff = new Date(
      Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );
    for (;;) {
      const res: { affected?: number | null } = await this.jobs
        .createQueryBuilder()
        .delete()
        .where(
          `id IN (SELECT id FROM "export_jobs" WHERE status IN ('expired','failed') AND created_at < :cutoff LIMIT :batch)`,
          { cutoff: purgeCutoff, batch: PURGE_BATCH },
        )
        .execute();
      if ((res.affected ?? 0) < PURGE_BATCH) break;
    }
  }
}
