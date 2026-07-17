import { Injectable } from '@nestjs/common';
import { PermissionsService } from '../../rbac/permissions.service';
import { StudentSearchDto } from '../../student-query/dto/student-search.dto';
import { StudentQueryService } from '../../student-query/student-query.service';

export const STUDENT_DIRECTORY_SCREEN_KEY = 'students.directory.view';

/**
 * Employee student directory — the RBAC-scoped wrapper around the shared
 * query engine. All four scope attributes are resolved for the screen and
 * intersected by the engine (three-state contract: 'all' = no predicate,
 * [] = empty result, ids = IN filter).
 */
@Injectable()
export class EmployeeStudentsSearchService {
  constructor(
    private readonly engine: StudentQueryService,
    private readonly permissions: PermissionsService,
  ) {}

  async search(employeeId: number, dto: StudentSearchDto) {
    const KEY = STUDENT_DIRECTORY_SCREEN_KEY;
    const [departmentIds, programmeIds, admissionYearIds, attendanceGroupIds] =
      await Promise.all([
        this.permissions.getAccessibleDepartmentIds(employeeId, KEY),
        this.permissions.getAccessibleProgrammeIds(employeeId, KEY),
        this.permissions.getAccessibleAdmissionYearIds(employeeId, KEY),
        this.permissions.getAccessibleAttendanceGroupIds(employeeId, KEY),
      ]);
    return this.engine.search(dto, {
      surface: 'employee',
      scope: { departmentIds, programmeIds, admissionYearIds, attendanceGroupIds },
    });
  }

  meta() {
    return this.engine.meta('employee');
  }
}
