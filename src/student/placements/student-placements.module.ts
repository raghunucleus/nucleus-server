import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriveManagementModule } from '../../employee/drive-management/drive-management.module';
import { Drive } from '../../employee/drive-management/entities/drive.entity';
import { DriveStudent } from '../../employee/drive-management/entities/drive-student.entity';
import { DriveStudentEvent } from '../../employee/drive-management/entities/drive-student-event.entity';
import { StudentApprovalsModule } from '../approvals/student-approvals.module';
import { StudentPlacementsController } from './student-placements.controller';
import { StudentPlacementsService } from './student-placements.service';

/**
 * Student-facing placements: invites + accepted drives. Reads the employee
 * module's DriveStudent rows and reuses DrivesService for the drive detail;
 * the student can only ever mutate their own membership row (accept/deny).
 *
 * The student JWT strategy is registered app-wide by StudentModule, and
 * StorageService comes from the @Global() StorageModule — neither needs an
 * import here (same as ChatModule).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Drive, DriveStudent, DriveStudentEvent]),
    DriveManagementModule,
    StudentApprovalsModule,
  ],
  controllers: [StudentPlacementsController],
  providers: [StudentPlacementsService],
})
export class StudentPlacementsModule {}
