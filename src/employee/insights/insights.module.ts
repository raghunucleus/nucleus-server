import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '../../rbac/rbac.module';
import { StudentQueryModule } from '../../student-query/student-query.module';
import { AttendanceAnalyticsModule } from '../attendance-analytics/attendance-analytics.module';
import { EmployeeAuthModule } from '../auth/employee-auth.module';
import { ExportsModule } from '../exports/exports.module';
import { InsightsAttendanceController } from './attendance/insights-attendance.controller';
import { InsightsAttendanceService } from './attendance/insights-attendance.service';
import { InsightsScopeController } from './insights-scope.controller';
import { InsightsScopeService } from './insights-scope.service';
import { InsightsOverviewController } from './overview/insights-overview.controller';
import { InsightsOverviewService } from './overview/insights-overview.service';
import { InsightsPlacementsController } from './placements/insights-placements.controller';
import { InsightsPlacementsService } from './placements/insights-placements.service';
import { InsightsRequestsController } from './requests/insights-requests.controller';
import { InsightsRequestsService } from './requests/insights-requests.service';
import { InsightsResultsController } from './results/insights-results.controller';
import { InsightsResultsService } from './results/insights-results.service';
import { InsightsStudentsController } from './students/insights-students.controller';
import { InsightsStudentsService } from './students/insights-students.service';
import { EmployeeSavedView } from './views/employee-saved-view.entity';
import { InsightsViewsController } from './views/insights-views.controller';
import { InsightsViewsService } from './views/insights-views.service';

/**
 * The `insights.*` screens — HOD / dean / principal / management analytics.
 *
 * One GET-only controller per screen, all resolving the caller's RBAC scope
 * through `InsightsScopeService` before touching data. Attendance reuses the
 * incharge analytics service over a wider scope (hence the module import);
 * the cohort explorer reuses the student-query engine; everything else is
 * aggregate SQL over the caches the owning modules already maintain.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EmployeeSavedView]),
    EmployeeAuthModule,
    RbacModule,
    AttendanceAnalyticsModule,
    StudentQueryModule,
    ExportsModule,
  ],
  controllers: [
    InsightsScopeController,
    InsightsOverviewController,
    InsightsAttendanceController,
    InsightsResultsController,
    InsightsPlacementsController,
    InsightsStudentsController,
    InsightsRequestsController,
    InsightsViewsController,
  ],
  providers: [
    InsightsScopeService,
    InsightsOverviewService,
    InsightsAttendanceService,
    InsightsResultsService,
    InsightsPlacementsService,
    InsightsStudentsService,
    InsightsRequestsService,
    InsightsViewsService,
  ],
})
export class InsightsModule {}
