/**
 * The student-set CTE every non-attendance insights query starts from.
 *
 *   $1 int[]        programme_admission_year ids — the resolved scope batches
 *   $2 int[] | null attendance_group ids when the caller narrowed to sections,
 *                   else NULL (no section predicate)
 *
 * Scope is ALWAYS a list of batches, never a (programmes × years) cross
 * product: a caller narrowing to "CSE 2022" and "ECE 2023" must not see "CSE
 * 2023". Students match their batch on the (programme, admission year) pair —
 * there is no `students.programme_admission_year_id` column.
 */
export const SCOPE_STUDENTS_CTE = `
  WITH sb AS (
    SELECT pay.id AS pay_id, pay.programme_id, pay.admission_year_id
      FROM programme_admission_years pay
     WHERE pay.id = ANY($1::int[])
  ),
  st AS (
    SELECT s.id AS student_id, s.student_id AS roll_no, s.display_name,
           s.programme_id, s.admission_year_id, sb.pay_id, s.pass_out_year,
           s.gender, s.entry_type, s.ug_cgpa, s.current_backlogs,
           s.backlog_history, s.allowed_by_dept_for_placements,
           s.interested_in_placements_self
      FROM students s
      JOIN sb ON sb.programme_id = s.programme_id
             AND sb.admission_year_id = s.admission_year_id
     WHERE s.is_active = TRUE
       AND ($2::int[] IS NULL OR EXISTS (
             SELECT 1 FROM student_groups sg
              WHERE sg.student_id = s.id
                AND sg.attendance_group_id = ANY($2::int[])))
  )`;

/** Postgres returns numerics and COUNTs as strings; normalise first. */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Two decimals — enough for an LPA or a GPA average. */
export function round2(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n * 100) / 100;
}

/** Whole percentage of `part` in `whole`, 0 when nothing to measure. */
export function pctInt(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
