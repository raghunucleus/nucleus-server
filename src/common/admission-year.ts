// Entry type 2 = Lateral (see ENTRY_TYPES in student.entity.ts). Lateral-entry
// students join directly into the second year — a full year after their batch's
// base admission year — so the admission year shown to them is shifted +1.
const LATERAL_ENTRY_TYPE = 2;

/**
 * The admission year to *display* for a student, given their entry type.
 *
 * Regular entry → the batch's `display_year` unchanged. Lateral entry → +1 with
 * a " (Lateral)" tag, a VIEW-ONLY shift: the stored batch / `admission_year` row
 * is never touched, we only render the year the student actually joined. Each
 * numeric run in the display string is incremented by one (width preserved), so
 * the format is kept intact: "2026-27" → "2027-28 (Lateral)" and
 * "2026-2027" → "2027-2028 (Lateral)". The tag makes the +1 obvious so the
 * shifted year can't be mistaken for the regular batch's.
 */
export function displayedAdmissionYear(
  displayYear: string,
  entryType: number,
): string {
  if (entryType !== LATERAL_ENTRY_TYPE) return displayYear;
  const shifted = displayYear.replace(/\d+/g, (run) =>
    String(Number(run) + 1).padStart(run.length, '0'),
  );
  return `${shifted} (Lateral)`;
}
