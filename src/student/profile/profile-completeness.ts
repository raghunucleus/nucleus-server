import { Student } from '../../admin/entities/student.entity';
import {
  PROFILE_FIELD_DEFS,
  PROFILE_GROUPS,
  appliesTo,
  columnOf,
} from './profile-fields';

export interface Completeness {
  required: number;
  filled: number;
  /** Field keys still unfilled, in registry order. */
  missing: string[];
}

/**
 * The single definition of "how complete is this profile", over the
 * mandatory-for-this-entry-type fields of the registry.
 *
 * Special cases: the entrance unit counts as filled when marked N/A; the gap
 * reason only counts once a gap actually exists; backlog_history always has a
 * value (boolean, defaulted).
 *
 * Deliberately pure — no repositories, no Nest DI — so the employee-facing
 * surfaces can compute it without importing `StudentModule` (which would close
 * the DriveManagementModule ← StudentPlacementsModule ← StudentModule cycle).
 * `StudentFullProfileService` and the placement-coordinator students screen
 * both call this; there must never be a second copy of these rules.
 */
export function computeCompleteness(s: Student): Completeness {
  const visibleGroups = new Set(
    PROFILE_GROUPS.filter((g) => appliesTo(g.visible, s.entry_type)).map(
      (g) => g.key,
    ),
  );

  const missing: string[] = [];
  let required = 0;

  for (const def of PROFILE_FIELD_DEFS) {
    if (!visibleGroups.has(def.group)) continue;
    if (!appliesTo(def.visible, s.entry_type)) continue;
    if (!appliesTo(def.mandatory, s.entry_type)) continue;

    required += 1;

    const col = columnOf(def);
    const value: unknown =
      def.key === 'admission_year'
        ? s.admission_year?.year
        : col
          ? s[col]
          : null;

    let filled: boolean;
    if (
      def.key === 'entrance_exam' ||
      def.key === 'entrance_exam_rank' ||
      def.key === 'entrance_exam_year'
    ) {
      filled = s.entrance_exam_na || (value !== null && value !== undefined);
    } else if (def.key === 'reason_of_gap') {
      filled = (s.year_of_gap ?? 0) === 0 || (value !== null && value !== '');
    } else if (def.key === 'backlog_history') {
      filled = true;
    } else {
      filled = value !== null && value !== undefined && value !== '';
    }

    if (!filled) missing.push(def.key);
  }

  return { required, filled: required - missing.length, missing };
}

/** Completion as a 0-100 integer; 0 required fields reads as 100% complete. */
export function completionPct(c: Completeness): number {
  if (c.required === 0) return 100;
  return Math.round((c.filled / c.required) * 100);
}
