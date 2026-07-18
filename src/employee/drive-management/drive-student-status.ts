/**
 * The drive-student lifecycle statuses.
 *
 * NUMERIC WITH GAPS ON PURPOSE: this is a deliberate, user-confirmed deviation
 * from the repo's string-status convention. The codes are spaced by 10 so a
 * future state can slot between two existing ones without renumbering (e.g. a
 * "35 shortlisted" between accepted and the outcomes). Do not "fix" this to
 * strings. Each client mirrors these codes + labels in its own lib.
 *
 * Flow:
 *   10 → 20 → { 30 | 40 }      (invite, then the student decides)
 *   30 → { 50 | 60 | 70 }      (placement cell records the drive-day outcome)
 *   20/30 → 80                 (placement cell revokes the candidate, reason req.)
 *   40, 50, 60, 70, 80 are terminal.
 *
 * Transition enforcement lives in the status-guarded UPDATEs in the services
 * (`WHERE status = <from>`), which also makes concurrent employee/student
 * actions race-safe — there is intentionally no runtime transition map.
 */
export const DRIVE_STUDENT_STATUS = {
  IMPORTED: 10,
  INVITED: 20,
  ACCEPTED: 30,
  DENIED: 40,
  NOT_ATTENDED: 50,
  SELECTED: 60,
  NOT_SELECTED: 70,
  REVOKED: 80,
} as const;

export type DriveStudentStatus =
  (typeof DRIVE_STUDENT_STATUS)[keyof typeof DRIVE_STUDENT_STATUS];

export const DRIVE_STUDENT_STATUS_LABELS: Record<DriveStudentStatus, string> = {
  10: 'Imported',
  20: 'Invited',
  30: 'Accepted (by student)',
  40: 'Denied (by student)',
  50: 'Not Attended',
  60: 'Selected',
  70: 'Not Selected',
  80: 'Revoked',
};

/** The drive-day outcomes the placement cell may set on an ACCEPTED row. */
export const OUTCOME_STATUSES = [
  DRIVE_STUDENT_STATUS.NOT_ATTENDED,
  DRIVE_STUDENT_STATUS.SELECTED,
  DRIVE_STUDENT_STATUS.NOT_SELECTED,
] as const;

export type DriveStudentOutcome = (typeof OUTCOME_STATUSES)[number];

/**
 * Statuses an employee may revoke from — Invited/Accepted. An Imported (10) row
 * was never contacted, so it is Deleted (hard-delete) instead of revoked; the
 * terminal states are left alone.
 */
export const REVOCABLE_STATUSES = [
  DRIVE_STUDENT_STATUS.INVITED,
  DRIVE_STUDENT_STATUS.ACCEPTED,
] as const;

/** Every action recorded in the drive_student_events audit log. */
export const DRIVE_STUDENT_ACTIONS = [
  'imported',
  'invited',
  'reminded',
  'accepted',
  'denied',
  'outcome',
  'revoked',
] as const;

export type DriveStudentAction = (typeof DRIVE_STUDENT_ACTIONS)[number];
