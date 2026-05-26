import type { ScreenDef } from './types';

/**
 * Initial seed of employee-facing screens. Engineering owns this list — to add
 * a new screen, append a ScreenDef and ship the matching page in the relevant
 * frontend. The catalog validator at boot ensures `module_key`,
 * `role_type_keys[]`, and every `attributes[].type` resolve.
 *
 * Conventions:
 *   - `key` is dot-separated: <module>.<resource>.<action-or-view>
 *   - `actions[]` are intra-screen permissions; assignments grant a subset
 *   - `attributes[]` are the data scope (department, programme, year, ...)
 *     the screen needs to constrain its queries. Missing required attributes
 *     on an assignment block save; missing values at runtime render an empty
 *     state instead of the screen content.
 */
export const SCREENS: ReadonlyArray<ScreenDef> = [
  // --- Employee ----------------------------------------------------------
  {
    key: 'employee.id_card.view',
    module_key: 'employee',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'Employee ID card',
    description: 'View your own employee ID card.',
    web_route: '/employee/id-card',
    mobile_route: '/employee/id-card',
    actions: ['view'],
    attributes: [],
  },
  {
    key: 'employee.events.view',
    module_key: 'employee',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'Events',
    description: 'View institution events.',
    web_route: '/employee/events',
    mobile_route: '/employee/events',
    actions: ['view'],
    attributes: [],
  },
  {
    key: 'employee.holiday_calendar.view',
    module_key: 'employee',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'Holiday calendar',
    description: 'View the institution holiday calendar.',
    web_route: '/employee/holiday-calendar',
    mobile_route: '/employee/holiday-calendar',
    actions: ['view'],
    attributes: [],
  },
  {
    key: 'employee.birthdays.view',
    module_key: 'employee',
    role_type_keys: ['employee'],
    platforms: ['web', 'mobile'],
    label: 'Birthdays',
    description: 'View birthdays of other employees.',
    web_route: '/employee/birthdays',
    mobile_route: '/employee/birthdays',
    actions: ['view'],
    attributes: [],
  },

  // --- Attendance --------------------------------------------------------
  {
    key: 'attendance.entry.daily',
    module_key: 'attendance',
    role_type_keys: ['teacher'],
    platforms: ['web', 'mobile'],
    label: 'Student attendance entry',
    description: 'Mark daily attendance for assigned groups.',
    web_route: '/attendance/mark',
    mobile_route: '/attendance/mark',
    actions: ['update'],
    attributes: [
    ],
  },
];
