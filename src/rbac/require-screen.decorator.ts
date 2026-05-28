import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SCREEN_METADATA = 'rbac:requireScreen';
export const REQUIRE_ANY_SCREEN_METADATA = 'rbac:requireAnyScreen';

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

/**
 * Allow access if the caller has ANY of the listed (screen, action) pairs.
 * Used for endpoints shared by two side-menu surfaces — e.g. a lookup the
 * incharge needs from both the templates page and the schedule page. The
 * server-side ownership scoping happens inside the handler; the screen
 * check is just "do they have a relevant menu item at all".
 *
 *     @RequireAnyScreen(
 *       { screenKey: 'timetable.incharge.templates.manage', action: 'view' },
 *       { screenKey: 'timetable.incharge.schedule.manage',  action: 'view' },
 *     )
 *
 * Pair with `ScreenAccessGuard` like `@RequireScreen`.
 */
export const RequireAnyScreen = (
  ...specs: RequireScreenSpec[]
): MethodDecorator & ClassDecorator =>
  SetMetadata<string, RequireScreenSpec[]>(
    REQUIRE_ANY_SCREEN_METADATA,
    specs,
  );
