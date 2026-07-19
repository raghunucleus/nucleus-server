import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { storageKey } from '../../storage/storage.constants';
import { StorageService } from '../../storage/storage.service';
import { EmployeeNotificationService } from '../notification/employee-notification.service';
import {
  ExportFormat,
  ExportJob,
  ExportJobStatus,
} from './entities/export-job.entity';

/** Most jobs one employee may have pending/processing at once. */
const MAX_ACTIVE_JOBS_PER_EMPLOYEE = 3;
/** How long a finished file stays downloadable (env `EXPORT_TTL_HOURS` overrides). */
const DEFAULT_TTL_HOURS = 24;
/** Presigned download URLs are one-shot and short — never longer than this. */
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;
/** Rows returned by the "my exports" list. */
const LIST_LIMIT = 100;

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export interface CreateExportJobInput {
  employeeId: number;
  /** Which feature produced the job, e.g. 'drive_students'. */
  source: string;
  /** Human context for lists/notifications, e.g. 'Students — TCS Campus Drive'. */
  label: string;
  context?: Record<string, unknown>;
  format: ExportFormat;
  /** Download filename suggested to the browser. */
  filename: string;
  /** Produces the finished file. Runs detached, after `create()` has returned. */
  generate: () => Promise<{ buffer: Buffer; rowCount: number }>;
}

/** Wire shape for the "my exports" list. */
export interface ExportJobDto {
  id: number;
  source: string;
  label: string;
  context: Record<string, unknown> | null;
  format: ExportFormat;
  status: ExportJobStatus;
  filename: string | null;
  row_count: number | null;
  error: string | null;
  expires_at: string | null;
  created_at: string;
}

/**
 * Generic async file-export framework: owns the job lifecycle, object storage,
 * the 24h expiry contract and the completion notification. It knows nothing
 * about WHAT is exported — callers hand `create()` a `generate` closure that
 * returns the finished buffer, so any feature can plug in.
 *
 * There is no durable queue in this codebase; jobs run as detached promises
 * (the established pattern) and the hourly cleanup cron doubles as crash
 * recovery, failing rows that have sat in pending/processing too long.
 */
@Injectable()
export class ExportJobsService {
  private readonly logger = new Logger('ExportJobs');
  private readonly ttlMs: number;

  constructor(
    @InjectRepository(ExportJob)
    private readonly jobs: Repository<ExportJob>,
    private readonly storage: StorageService,
    private readonly notifications: EmployeeNotificationService,
    config: ConfigService,
  ) {
    const hours = Number(config.get<string>('EXPORT_TTL_HOURS'));
    this.ttlMs =
      (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) *
      60 *
      60 *
      1000;
  }

  async create(input: CreateExportJobInput): Promise<{ id: number }> {
    const active = await this.jobs.countBy({
      employee_id: input.employeeId,
      status: In(['pending', 'processing']),
    });
    if (active >= MAX_ACTIVE_JOBS_PER_EMPLOYEE) {
      throw new BadRequestException(
        `You already have ${active} exports in progress. Wait for one to finish before starting another.`,
      );
    }

    const job = await this.jobs.save(
      this.jobs.create({
        employee_id: input.employeeId,
        source: input.source,
        label: input.label,
        context: input.context ?? null,
        format: input.format,
        status: 'pending',
        filename: input.filename,
      }),
    );

    void this.run(job.id, input).catch((err: unknown) => {
      this.logger.error(
        `Export job ${job.id} crashed outside run(): ${String(err)}`,
      );
    });

    return { id: job.id };
  }

  /** The detached worker: generate → upload → mark ready → notify. */
  private async run(jobId: number, input: CreateExportJobInput): Promise<void> {
    await this.jobs.update(jobId, { status: 'processing' });
    try {
      const { buffer, rowCount } = await input.generate();
      const key = storageKey.exportFile(input.employeeId, input.format);
      await this.storage.putObject(key, buffer, CONTENT_TYPES[input.format]);
      const expiresAt = new Date(Date.now() + this.ttlMs);
      await this.jobs.update(jobId, {
        status: 'ready',
        storage_key: key,
        row_count: rowCount,
        expires_at: expiresAt,
      });
      void this.notifications
        .send(
          input.employeeId,
          {
            module: 'exports',
            type: 'export-ready',
            title: 'Export ready',
            body: `"${input.label}" (${rowCount} rows, ${input.format.toUpperCase()}) is ready to download. The link expires in 24 hours.`,
            target: { type: 'export', id: jobId },
          },
          { collapseKey: `export-${jobId}` },
        )
        .catch(() => undefined);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Export generation failed.';
      this.logger.error(`Export job ${jobId} failed: ${message}`);
      await this.jobs.update(jobId, {
        status: 'failed',
        error: message.slice(0, 512),
      });
      void this.notifications
        .send(
          input.employeeId,
          {
            module: 'exports',
            type: 'export-failed',
            title: 'Export failed',
            body: `"${input.label}" could not be generated: ${message.slice(0, 200)}`,
            target: { type: 'export', id: jobId },
          },
          { collapseKey: `export-${jobId}` },
        )
        .catch(() => undefined);
    }
  }

  async listMine(employeeId: number): Promise<ExportJobDto[]> {
    const rows = await this.jobs.find({
      where: { employee_id: employeeId },
      order: { created_at: 'DESC' },
      take: LIST_LIMIT,
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * A short-lived presigned URL for one finished export the caller owns.
   * Expiry is enforced here against `expires_at` itself — not just the row
   * status — so a click in the window between expiry and the hourly cron sweep
   * still gets a clean 410 rather than a signed URL to a soon-dead object.
   */
  async downloadUrl(employeeId: number, id: number): Promise<{ url: string }> {
    const job = await this.jobs.findOneBy({ id });
    if (!job || job.employee_id !== employeeId) {
      throw new NotFoundException('Export not found.');
    }
    if (job.status === 'pending' || job.status === 'processing') {
      throw new ConflictException('This export is still being generated.');
    }
    if (job.status === 'failed') {
      throw new GoneException(job.error ?? 'This export failed.');
    }
    const msLeft = job.expires_at ? job.expires_at.getTime() - Date.now() : 0;
    if (job.status === 'expired' || !job.storage_key || msLeft <= 0) {
      throw new GoneException(
        'This export has expired. Exports are kept for 24 hours — run it again.',
      );
    }
    const ttl = Math.max(
      1,
      Math.min(DOWNLOAD_URL_TTL_SECONDS, Math.floor(msLeft / 1000)),
    );
    const url = await this.storage.getSignedReadUrl(job.storage_key, ttl);
    return { url };
  }

  private toDto(job: ExportJob): ExportJobDto {
    return {
      id: job.id,
      source: job.source,
      label: job.label,
      context: job.context,
      format: job.format,
      status: job.status,
      filename: job.filename,
      row_count: job.row_count,
      error: job.error,
      expires_at: job.expires_at ? job.expires_at.toISOString() : null,
      created_at: job.created_at.toISOString(),
    };
  }
}
