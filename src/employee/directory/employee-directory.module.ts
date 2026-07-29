import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from '../../admin/entities/employee.entity';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { EmployeeDirectoryController } from './employee-directory.controller';
import { EmployeeDirectoryService } from './employee-directory.service';

/**
 * The employee-portal staff directory — one read-only typeahead endpoint that
 * every people picker in the portal shares, instead of each feature growing
 * its own screen-gated lookup route (which is how the timetable module ended
 * up loading a thousand employees at once).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Employee]), EmployeeAuthModule],
  controllers: [EmployeeDirectoryController],
  providers: [EmployeeDirectoryService],
  exports: [EmployeeDirectoryService],
})
export class EmployeeDirectoryModule {}
