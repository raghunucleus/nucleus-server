import { Module } from '@nestjs/common';
import { RbacModule } from '../../rbac/rbac.module';
import { StudentQueryModule } from '../../student-query/student-query.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { EmployeeStudentsSearchController } from './employee-students-search.controller';
import { EmployeeStudentsSearchService } from './employee-students-search.service';

/**
 * Employee-facing student directory (screen `students.directory.view`).
 * Thin RBAC wrapper over the shared StudentQueryModule engine.
 */
@Module({
  imports: [StudentQueryModule, RbacModule, EmployeeAuthModule],
  controllers: [EmployeeStudentsSearchController],
  providers: [EmployeeStudentsSearchService],
})
export class EmployeeStudentsModule {}
