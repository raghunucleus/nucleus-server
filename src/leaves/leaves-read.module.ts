import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeaveType } from '../admin/entities/leave-type.entity';
import { StudentLeave } from './entities/student-leave.entity';
import { LeavesReadService } from './leaves-read.service';

/**
 * Read-only "who is on leave" layer shared by attendance marking (admin +
 * teacher) and the teacher roster. Kept separate from the student leaves
 * module (which owns writes and plugs into the requests framework) so those
 * consumers pull in only the read, exactly like HolidaysReadModule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([StudentLeave, LeaveType])],
  providers: [LeavesReadService],
  exports: [LeavesReadService],
})
export class LeavesReadModule {}
