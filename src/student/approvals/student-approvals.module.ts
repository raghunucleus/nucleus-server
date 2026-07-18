import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriveStudent } from '../../employee/drive-management/entities/drive-student.entity';
import { StudentApprovalsController } from './student-approvals.controller';
import { StudentApprovalsService } from './student-approvals.service';
import { StudentApprovalsSyncService } from './student-approvals-sync.service';
import { StudentApproval } from './entities/student-approval.entity';

/**
 * The student approvals inbox + the sync service every owning module uses to
 * mirror its transitions into `student_approvals`.
 *
 * `StudentApprovalsSyncService` is dependency-free (only its own repository), so
 * `DriveManagementModule` / `StudentPlacementsModule` import this module purely
 * to get it — no circular dependency. The read side registers its own
 * `DriveStudent` repository to hydrate placement cards (StorageService is
 * @Global, the student JWT strategy is app-wide) rather than importing those
 * modules back, which keeps the dependency one-way.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StudentApproval, DriveStudent])],
  controllers: [StudentApprovalsController],
  providers: [StudentApprovalsService, StudentApprovalsSyncService],
  exports: [StudentApprovalsSyncService],
})
export class StudentApprovalsModule {}
