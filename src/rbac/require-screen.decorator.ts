import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SCREEN_METADATA = 'rbac:requireScreen';

export interface RequireScreenSpec {
  screenKey: string;
  action: string;
}

/**
 * Mark a controller handler as requiring access to a specific catalog screen
 * (with at least the named action) for the current authenticated employee.
 * Used together with `EmployeeJwtAuthGuard` + `ScreenAccessGuard`:
 *
 *     @RequireScreen('academics.timetable.manage', 'edit')
 *     @UseGuards(EmployeeJwtAuthGuard, ScreenAccessGuard)
 *     @Patch(':id') updateTimetable(...) { ... }
 *
 * Action defaults to `'view'` for read endpoints.
 */
export const RequireScreen = (
  screenKey: string,
  action: string = 'view',
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, RequireScreenSpec>(REQUIRE_SCREEN_METADATA, {
    screenKey,
    action,
  });
