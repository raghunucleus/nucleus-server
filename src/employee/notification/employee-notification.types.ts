/**
 * The employee notification contract — shared, route-independent vocabulary the
 * server and every employee client (web portal + employee mobile) agree on.
 *
 * The server NEVER stores a literal client URL. It stores a stable `module` key
 * plus an optional semantic `target`. Each client owns a registry that maps
 * `module → route` and resolves `target → specific screen`, with a fallback
 * chain (specific target → module home → "no longer available"). A route rename
 * on either client touches only that client's registry — never the server or
 * the stored rows.
 *
 * This is the employee-only system, deliberately parallel to (never shared
 * with) the student one: own entities, tables, gateway, tokens and push
 * registrations, so an employee token can never read a student's notifications.
 */

/**
 * Stable module identifiers an employee notification can belong to. Mirror this
 * list as a frozen constant on each client. Add a key here (and to each client
 * registry) when a new module starts sending — no migration needed, the column
 * is a plain `varchar`.
 *
 * Only 'requests' sends today; the rest are declared up front so the first
 * trigger in each module is a one-line `send(...)` call.
 */
export type EmployeeNotificationModuleKey =
  | 'requests'
  | 'attendance'
  | 'timetable'
  | 'exam-marks'
  | 'birthdays'
  | 'id-card'
  | 'profile'
  | 'corporate-relations'
  | 'announcements';

/** Every module key, in the order a preferences screen should list them. */
export const EMPLOYEE_NOTIFICATION_MODULE_KEYS: readonly EmployeeNotificationModuleKey[] =
  [
    'requests',
    'attendance',
    'timetable',
    'exam-marks',
    'birthdays',
    'id-card',
    'profile',
    'corporate-relations',
    'announcements',
  ] as const;

/** Human labels for the preferences screen — the server owns the wording. */
export const EMPLOYEE_NOTIFICATION_MODULE_LABELS: Record<
  EmployeeNotificationModuleKey,
  string
> = {
  requests: 'Approvals & requests',
  attendance: 'Attendance',
  timetable: 'Timetable',
  'exam-marks': 'Exam marks',
  birthdays: 'Birthdays',
  'id-card': 'ID card',
  profile: 'Profile',
  'corporate-relations': 'Corporate relations',
  announcements: 'Announcements',
};

/**
 * The specific entity a notification points at, described semantically rather
 * than as a URL. `type` names the entity kind (e.g. `'request'`), `id` is its
 * identifier, and `params` carries any extra values a client's router needs
 * (clients pick what they require — web and mobile can deep-link differently).
 */
export interface NotificationTarget {
  type: string;
  id?: string | number;
  params?: Record<string, string>;
}

/**
 * What a sending module passes to {@link EmployeeNotificationService.send}. The
 * recipient(s) are given separately; `target` is server-authored and is never
 * accepted from a client request.
 */
export interface SendEmployeeNotificationInput {
  module: EmployeeNotificationModuleKey;
  /** Sub-kind within the module (e.g. 'profile_update-raised'); drives client icon. */
  type: string;
  title: string;
  body: string;
  target?: NotificationTarget | null;
}

/** One notification as returned to the client (REST list + socket events). */
export interface EmployeeNotificationDto {
  id: number;
  module: EmployeeNotificationModuleKey;
  type: string;
  title: string;
  body: string;
  target: NotificationTarget | null;
  read_at: string | null;
  created_at: string;
}

/** A page of notification history, newest first, plus the live unread total. */
export interface EmployeeNotificationsPage {
  items: EmployeeNotificationDto[];
  has_more: boolean;
  unread: number;
}

/**
 * One module's effective delivery preferences. In-app is deliberately absent:
 * it is the notification list itself and cannot be switched off — a
 * notification that lands nowhere visible is indistinguishable from a bug.
 */
export interface EmployeeNotificationPreferenceDto {
  module: EmployeeNotificationModuleKey;
  label: string;
  email_enabled: boolean;
  push_enabled: boolean;
}
