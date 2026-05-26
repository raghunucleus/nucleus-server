import { Module } from '@nestjs/common';

/**
 * HOD-specific endpoints land here. Each handler MUST follow the RBAC
 * enforcement contract (see nucleus-server/CLAUDE.md):
 *
 *   @RequireScreen('<screen.key>', '<action>')
 *   @UseGuards(EmployeeJwtAuthGuard, ScreenAccessGuard)
 *
 * and scope every query/mutation with PermissionsService.getAccessibleX(...)
 * — typically `getAccessibleDepartmentIds(...)` for HOD screens.
 */
@Module({})
export class HodModule {}
