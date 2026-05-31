/**
 * Grade catalog and examination parsing for the exam-cell grade-sheet upload.
 *
 * The upload sheet (`Sheet4` of the institutional export) carries one row per
 * (student × subject × sitting) with a letter grade, the credits *earned*
 * (0 for a fail/audit, the subject's full credit otherwise) and the grade
 * points. SGPA/CGPA are credit-weighted averages of grade points; see
 * `ExamMarksService` for the formulas.
 */

/** Valid letter grades, in descending merit order. */
export const GRADES = ['O', 'S', 'A', 'B', 'C', 'D', 'F', 'P'] as const;
export type Grade = (typeof GRADES)[number];

/**
 * Letter grade → grade points. `F` (fail) and `P` (non-credit audit) are both
 * 0; in the source sheet their credits are also 0, so they contribute nothing
 * to SGPA/CGPA and drop out of the credit-weighted average naturally.
 */
export const GRADE_POINT_MAP: Record<Grade, number> = {
  O: 10,
  S: 9,
  A: 8,
  B: 7,
  C: 6,
  D: 5,
  F: 0,
  P: 0,
};

/** Letter grade → human-readable meaning, for display. */
export const GRADE_MEANING_MAP: Record<Grade, string> = {
  O: 'Superior',
  S: 'Excellent',
  A: 'Very Good',
  B: 'Good',
  C: 'Average',
  D: 'Pass',
  F: 'Fail',
  P: 'Satisfactory',
};

export const EXAM_TYPES = ['regular', 'supply'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

const YEAR_ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };
const SEM_ROMAN: Record<string, number> = { I: 1, II: 2 };

const EXAMINATION_RE =
  /^(I|II|III|IV)\s+YEAR\s+(I|II)\s+SEMESTER\s+(REGULAR|SUPPLY)$/i;

export interface ParsedExamination {
  /** 1–8, derived as (year - 1) * 2 + semesterInYear. */
  semester: number;
  exam_type: ExamType;
}

/**
 * Parse a column-A "Examination" label such as
 * `"III YEAR I SEMESTER Supply"` into a 1–8 semester number and exam type.
 * Returns `null` when the label does not match the expected shape — the caller
 * turns that into a row-level validation error. Trailing spaces (present in the
 * source sheet) are tolerated.
 */
export function parseExamination(raw: string): ParsedExamination | null {
  const m = EXAMINATION_RE.exec(raw.trim());
  if (!m) return null;
  const year = YEAR_ROMAN[m[1].toUpperCase()];
  const semInYear = SEM_ROMAN[m[2].toUpperCase()];
  if (!year || !semInYear) return null;
  return {
    semester: (year - 1) * 2 + semInYear,
    exam_type: m[3].toLowerCase() as ExamType,
  };
}
