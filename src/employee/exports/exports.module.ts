import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { ExportCleanupService } from './export-cleanup.service';
import { ExportJobsService } from './export-jobs.service';
import { ExportsController } from './exports.controller';
import { ExportJob } from './entities/export-job.entity';

/**
 * Generic async export framework: job lifecycle, storage, 24h expiry and the
 * completion notification. Feature modules import this and call
 * `ExportJobsService.create()` with a `generate` closure — creation is always
 * gated by the OWNING feature's RBAC screen, never here.
 *
 * StorageService and EmployeeNotificationService come from global modules.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ExportJob]),
    ConfigModule,
    EmployeeAuthModule,
  ],
  controllers: [ExportsController],
  providers: [ExportJobsService, ExportCleanupService],
  exports: [ExportJobsService],
})
export class ExportsModule {}
