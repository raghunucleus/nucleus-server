import type { LeaveAttachment } from '../../leaves/entities/student-leave.entity';
import type { RequestTypeModuleDef } from '../../requests/request-type.registry';

export const LEAVE_APPLY_TYPE = 'leave_apply' as const;
export const LEAVE_CANCEL_TYPE = 'leave_cancel' as const;

/** Both leave types share one Modules-tree branch; the registry insists they agree. */
export const LEAVES_REQUEST_MODULE: RequestTypeModuleDef = {
  key: 'leaves',
  label: 'Leaves',
  icon: 'CalendarOff',
  order: 15,
};

export interface LeaveTypeRef {
  id: number;
  name: string;
}

/**
 * Payload of a `leave_apply` request. `leave_id` is absent when the payload is
 * built and stamped by the handler's `onRaised` once the `student_leaves` row
 * exists; `outcome` is written by `applyDecision`.
 *
 * Type aliases (not interfaces) so they stay assignable to the framework's
 * opaque `Record<string, unknown>` payload column.
 */
export type LeaveApplyPayload = {
  v: 1;
  leave_id?: number;
  leave_type: LeaveTypeRef;
  from_date: string;
  to_date: string;
  /**
   * Partial-day window ('HH:MM:SS'), or both null for a full day. Single-day
   * leaves only — the leave then covers just the classes whose period run
   * overlaps it.
   */
  from_time: string | null;
  to_time: string | null;
  /** Inclusive calendar days — display only, recomputable from the dates. */
  days: number;
  reason: string | null;
  attachments: LeaveAttachment[];
  outcome?: 'approved' | 'rejected';
};

/** Payload of a `leave_cancel` request — snapshots the leave it targets. */
export type LeaveCancelPayload = {
  v: 1;
  leave_id: number;
  leave_type: LeaveTypeRef;
  from_date: string;
  to_date: string;
  from_time: string | null;
  to_time: string | null;
  days: number;
  /** Why the student wants the leave cancelled. */
  reason: string | null;
  outcome?: 'approved' | 'rejected';
};

/** Attachment as the DETAIL views render it — `url` is presigned per view. */
export interface LeaveAttachmentView extends LeaveAttachment {
  url?: string;
}

/** What approving/cancelling this leave does to the student's attendance. */
export interface LeaveImpact {
  /** Marked sessions in range where the student is currently `absent`. */
  absent_sessions: number;
  /** Marked sessions in range already recorded as `leave`. */
  leave_sessions: number;
  /** Marked sessions in range the student attended (present/late) — untouched. */
  attended_sessions: number;
  /** Sessions in range still to be held for the student's group/electives. */
  upcoming_sessions: number;
  /**
   * Sessions in range that are cancelled — shown so the approver can see a
   * request that names periods which will not run. Never acted on: a cancelled
   * class is not held, so it neither flips nor moves the percentage.
   */
  cancelled_sessions: number;
}

const MS_PER_DAY = 86_400_000;

/** Inclusive day count between two 'YYYY-MM-DD' dates (UTC math). */
export function inclusiveDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / MS_PER_DAY) + 1);
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatDay(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split('-').map(Number);
  const base = `${d} ${MONTHS[(m ?? 1) - 1] ?? ''}`;
  return withYear ? `${base} ${y}` : base;
}

/** "12 Sep 2026" or "12 Sep – 14 Sep 2026" — notification/error copy. */
export function formatLeaveRange(from: string, to: string): string {
  if (from === to) return formatDay(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDay(from, !sameYear)} – ${formatDay(to, true)}`;
}

/** 'HH:MM:SS' (or 'HH:MM') → 'HH:MM'. */
export function shortTime(t: string): string {
  return t.slice(0, 5);
}

/**
 * The full "when" of a leave: the date range, plus the clock window when it is
 * a partial day — "12 Sep 2026 · 10:00–12:40".
 */
export function formatLeaveWhen(
  from: string,
  to: string,
  fromTime: string | null,
  toTime: string | null,
): string {
  const range = formatLeaveRange(from, to);
  if (!fromTime || !toTime) return range;
  return `${range} · ${shortTime(fromTime)}–${shortTime(toTime)}`;
}
