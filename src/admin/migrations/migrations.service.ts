import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, MigrationExecutor, QueryFailedError } from 'typeorm';

export interface MigrationInfo {
  name: string;
  timestamp: number;
}

export interface ExecutedMigrationInfo extends MigrationInfo {
  id: number;
}

export interface MigrationStatus {
  executed: ExecutedMigrationInfo[];
  pending: MigrationInfo[];
  executedCount: number;
  pendingCount: number;
  hasPending: boolean;
  runEnabled: boolean;
}

export interface RunMigrationsResult {
  success: true;
  executed: MigrationInfo[];
  executedCount: number;
  durationMs: number;
}

@Injectable()
export class MigrationsService {
  private readonly logger = new Logger(MigrationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  isRunEnabled(): boolean {
    const flag = this.config.get<string>('ALLOW_ADMIN_MIGRATIONS');
    return flag === 'true' || flag === '1';
  }

  assertRunEnabled(): void {
    if (!this.isRunEnabled()) {
      throw new ServiceUnavailableException({
        error: 'MigrationsRunDisabled',
        message:
          'Running migrations from the admin API is disabled. Set ALLOW_ADMIN_MIGRATIONS=true to enable.',
      });
    }
  }

  async getStatus(): Promise<MigrationStatus> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      const executor = new MigrationExecutor(this.dataSource, queryRunner);
      const [allMigrations, executedMigrations] = await Promise.all([
        executor.getAllMigrations(),
        executor.getExecutedMigrations(),
      ]);

      const executedNames = new Set(executedMigrations.map((m) => m.name));
      const pending: MigrationInfo[] = allMigrations
        .filter((m) => !executedNames.has(m.name))
        .map((m) => ({ name: m.name, timestamp: m.timestamp }))
        .sort((a, b) => a.timestamp - b.timestamp);

      const executed: ExecutedMigrationInfo[] = executedMigrations
        .map((m) => ({
          id: typeof m.id === 'number' ? m.id : 0,
          name: m.name,
          timestamp: m.timestamp,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);

      return {
        executed,
        pending,
        executedCount: executed.length,
        pendingCount: pending.length,
        hasPending: pending.length > 0,
        runEnabled: this.isRunEnabled(),
      };
    } finally {
      await queryRunner.release();
    }
  }

  async runMigrations(): Promise<RunMigrationsResult> {
    this.assertRunEnabled();

    const start = Date.now();
    try {
      const result = await this.dataSource.runMigrations({
        transaction: 'each',
      });
      const executed = result.map((m) => ({
        name: m.name,
        timestamp: m.timestamp,
      }));
      this.logger.log(
        `Ran ${executed.length} migration(s): ${executed
          .map((m) => m.name)
          .join(', ') || '(none pending)'}`,
      );
      return {
        success: true,
        executed,
        executedCount: executed.length,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      this.logger.error('Migration run failed', err as Error);
      throw this.toMigrationException(err);
    }
  }

  private toMigrationException(err: unknown): InternalServerErrorException {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof QueryFailedError) {
      const driver = err.driverError as
        | {
            code?: string;
            detail?: string;
            hint?: string;
            schema?: string;
            table?: string;
            column?: string;
            constraint?: string;
            position?: string;
            where?: string;
          }
        | undefined;

      return new InternalServerErrorException({
        error: 'MigrationFailed',
        message,
        query: err.query,
        parameters: err.parameters,
        driver: {
          code: driver?.code,
          detail: driver?.detail,
          hint: driver?.hint,
          schema: driver?.schema,
          table: driver?.table,
          column: driver?.column,
          constraint: driver?.constraint,
          position: driver?.position,
          where: driver?.where,
        },
      });
    }

    return new InternalServerErrorException({
      error: 'MigrationFailed',
      message,
    });
  }
}
