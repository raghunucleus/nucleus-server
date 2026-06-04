import { GRADE_MEANING_MAP, type Grade } from './exam-marks.constants';
import { StudentExamResult } from './entities/student-exam-result.entity';

/** One sitting of a subject (with the counted attempt flagged). */
export interface ResultAttempt {
  exam_type: string;
  exam_date: string;
  grade: string;
  grade_points: number;
  grade_meaning: string;
  /** True for the sitting that counts toward SGPA/CGPA (the best attempt). */
  is_best: boolean;
}

/** One subject — the counted attempt as the headline + its full history. */
export interface ResultSubject {
  subject_code: string;
  subject_name: string;
  credits: number;
  grade: string;
  grade_points: number;
  grade_meaning: string;
  exam_type: string;
  /** How many times the student sat this subject (incl. the counted one). */
  attempts_count: number;
  /** Every sitting, oldest → newest, with the counted one flagged. */
  attempts: ResultAttempt[];
}

/**
 * Group committed exam-result rows into per-semester subjects, each carrying
 * its full sitting history with the counted (best) attempt flagged and used as
 * the subject headline. Shared by the student's own results view and the
 * exam-cell "Student marks" view so both render identically.
 *
 * Expects `rows` ordered by semester ASC, subject_code ASC, exam_date ASC so
 * subjects come out A→Z and attempts oldest→newest.
 */
export function groupSubjectsBySemester(
  rows: StudentExamResult[],
): Map<number, ResultSubject[]> {
  // semester → subject_code → sittings
  const grouped = new Map<number, Map<string, StudentExamResult[]>>();
  for (const r of rows) {
    const bySubject =
      grouped.get(r.semester) ?? new Map<string, StudentExamResult[]>();
    const sittings = bySubject.get(r.subject_code) ?? [];
    sittings.push(r);
    bySubject.set(r.subject_code, sittings);
    grouped.set(r.semester, bySubject);
  }

  const out = new Map<number, ResultSubject[]>();
  for (const [sem, bySubject] of grouped) {
    const list: ResultSubject[] = [];
    for (const sittings of bySubject.values()) {
      const best =
        sittings.find((s) => s.is_best) ?? sittings[sittings.length - 1];
      list.push({
        subject_code: best.subject_code,
        subject_name: best.subject_name,
        credits: Number(best.credits),
        grade: best.grade,
        grade_points: Number(best.grade_points),
        grade_meaning: GRADE_MEANING_MAP[best.grade as Grade] ?? '',
        exam_type: best.exam_type,
        attempts_count: sittings.length,
        attempts: sittings.map((a) => ({
          exam_type: a.exam_type,
          exam_date: a.exam_date,
          grade: a.grade,
          grade_points: Number(a.grade_points),
          grade_meaning: GRADE_MEANING_MAP[a.grade as Grade] ?? '',
          is_best: a.is_best,
        })),
      });
    }
    out.set(sem, list);
  }
  return out;
}
