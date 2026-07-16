/**
 * The student notification contract — shared, route-independent vocabulary the
 * server and every student client (web + mobile) agree on.
 *
 * The server NEVER stores a literal client URL. It stores a stable `module`
 * key plus an optional semantic `target`. Each client owns a registry that maps
 * `module → route` and resolves `target → specific screen`, with a fallback
 * chain (specific target → module home → "no longer available"). A route rename
 * on either client touches only that client's registry — never the server or
 * the stored rows.
 *
 * This is the student-only system. Employees and parents will get their own
 * `Employee*` / `Parent*` notification types, kept entirely separate.
 */

/**
 * Stable module identifiers a notification can belong to. Mirror this list as a
 * frozen constant on each client. Add a key here (and to each client registry)
 * when a new module starts sending notifications — no migration needed, the
 * column is a plain `varchar`.
 */
export type StudentNotificationModuleKey =
  | 'chat'
  | 'attendance'
  | 'exam-marks'
  | 'fees'
  | 'timetable'
  | 'birthdays'
  | 'id-card'
  | 'profile'
  | 'requests'
  | 'announcements';

/**
 * The specific entity a notification points at, described semantically rather
 * than as a URL. `type` names the entity kind (e.g. `'conversation'`), `id` is
 * its identifier, and `params` carries any extra values a client's router needs
 * (clients pick what they require — web and mobile can deep-link differently).
 */
export interface NotificationTarget {
  type: string;
  id?: string | number;
  params?: Record<string, string>;
}

/**
 * What a sending module passes to {@link StudentNotificationService.send}. The
 * acting recipient(s) are given separately; `target` is server-authored and is
 * never accepted from a client request.
 */
export interface SendStudentNotificationInput {
  module: StudentNotificationModuleKey;
  /** Sub-kind within the module (e.g. 'message', 'fee-due'); drives client icon. */
  type: string;
  title: string;
  body: string;
  target?: NotificationTarget | null;
}

/** One notification as returned to the client (REST list + socket events). */
export interface StudentNotificationDto {
  id: number;
  module: StudentNotificationModuleKey;
  type: string;
  title: string;
  body: string;
  target: NotificationTarget | null;
  read_at: string | null;
  created_at: string;
}

/** A page of notification history, newest first, plus the live unread total. */
export interface StudentNotificationsPage {
  items: StudentNotificationDto[];
  has_more: boolean;
  unread: number;
}
