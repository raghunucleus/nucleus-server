/**
 * The three CTEs every attendance-analytics query is built on, shared by the
 * incharge screen (`AttendanceAnalyticsService`, one group + one semester) and
 * the Insights attendance screen (many groups across many batches at once).
 *
 * Every query using them is written against the same four positional
 * parameters:
 *   $1 int[]  attendance_group_ids
 *   $2 int[]  programme_semester_ids (one per batch in scope)
 *   $3 date   from (nullable)
 *   $4 date   to   (nullable)
 * Endpoints that need more append from $5 onward.
 *
 * The incharge surface passes one-element arrays, so its behaviour is exactly
 * what it was when the CTEs took scalars. Because a student belongs to exactly
 * one batch, and each batch contributes at most one programme semester to
 * `$2`, a roster student only ever matches the rows of their own semester —
 * widening both sets together never cross-counts.
 */

/** Current active members of the groups. */
export const ROSTER_CTE = `
  WITH roster AS (
    SELECT s.id AS student_id, s.student_id AS roll_no, s.display_name
      FROM students s
      JOIN student_groups sg ON sg.student_id = s.id
     WHERE sg.attendance_group_id = ANY($1::int[]) AND s.is_active = TRUE
  )`;

/**
 * The sessions themselves — the base for anything counting what was scheduled,
 * marked or missed.
 *
 * Cross-group elective cohorts (`attendance_group_id IS NULL`) are resolved
 * through `programme_semester_subject_option_students`, matching
 * `RosterService.forSession`. Two details matter:
 *
 *   - the join is on `scheduled_employee_id`, NOT `effective_employee_id` — the
 *     cohort is keyed on the scheduled teacher, and a substitution flips the
 *     effective one;
 *   - membership must NOT be resolved through `class_session_attendance`. An
 *     unmarked session has no attendance rows by definition, and unmarked
 *     sessions are exactly what this CTE exists to surface.
 */
export const SCOPED_SESSIONS_CTE = `
  scoped_sessions AS (
    SELECT cs.*
      FROM class_sessions cs
     WHERE cs.programme_semester_id = ANY($2::int[])
       AND ($3::date IS NULL OR cs.session_date >= $3::date)
       AND ($4::date IS NULL OR cs.session_date <= $4::date)
       AND (
         cs.attendance_group_id = ANY($1::int[])
         OR (
           cs.attendance_group_id IS NULL
           AND cs.programme_semester_subject_option_id IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM programme_semester_subject_option_students pos
               JOIN roster r ON r.student_id = pos.student_id
              WHERE pos.programme_semester_subject_option_id
                      = cs.programme_semester_subject_option_id
                AND pos.employee_id = cs.scheduled_employee_id
           )
         )
       )
  )`;

/**
 * The attendance rows — the base for anything computing a percentage.
 *
 * Driven from `roster`, so it picks up a group student's cross-group elective
 * marks (whose session has no `attendance_group_id`) that a column filter would
 * drop. The two predicates `cs.status = 'completed'` and
 * `status IN ('present','late')` mirror `AttendanceMarkingService.recomputeRollup`
 * exactly; changing either makes this screen disagree with the student's own
 * dashboard.
 *
 * NEVER count sessions here — a transferred student carries their previous
 * group's rows, so `COUNT(DISTINCT session_id)` is not "sessions this group
 * held". Use `scoped_sessions` for inventory.
 */
export const MARKS_CTE = `
  marks AS (
    SELECT csa.student_id, cs.id AS session_id, cs.session_date, cs.day_of_week,
           cs.subject_id, cs.span, cs.timetable_period_id,
           cs.effective_employee_id, cs.attendance_group_id,
           cs.programme_semester_id, csa.status
      FROM roster r
      JOIN class_session_attendance csa ON csa.student_id = r.student_id
      JOIN class_sessions cs ON cs.id = csa.class_session_id
     WHERE cs.programme_semester_id = ANY($2::int[])
       AND cs.status = 'completed'
       AND ($3::date IS NULL OR cs.session_date >= $3::date)
       AND ($4::date IS NULL OR cs.session_date <= $4::date)
  )`;
