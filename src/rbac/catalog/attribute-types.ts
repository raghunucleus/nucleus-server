import type { AttributeTypeDef } from './types';

/**
 * Catalog of attribute kinds a screen can declare in its attribute schema.
 *
 * Picker data is supplied by the matching fetcher in `attribute-fetchers.ts`
 * (one per key here) — the boot-time validator enforces 1:1 coverage. There
 * is no URL or field-mapping on the catalog itself; the fetcher returns the
 * canonical `{ id, label }` shape directly.
 *
 * To add a new attribute type:
 *   1. Add a `{ key, label, source }` row here.
 *   2. Add a fetcher under the same key in `attribute-fetchers.ts`.
 *   3. Reference the new key from a screen's attribute schema in screens.ts.
 */
export const ATTRIBUTE_TYPES: ReadonlyArray<AttributeTypeDef> = [
  {
    key: 'ref:department',
    label: 'Department',
    source: 'departments',
  },
  {
    key: 'ref:programme',
    label: 'Programme',
    source: 'programmes',
  },
  {
    key: 'ref:admission_year',
    label: 'Admission year',
    source: 'admission_years',
  },
  {
    key: 'ref:semester',
    label: 'Semester',
    source: 'semesters',
  },
  {
    key: 'ref:regulation',
    label: 'Regulation',
    source: 'regulations',
  },
  {
    key: 'ref:attendance_group',
    label: 'Attendance group',
    source: 'attendance_groups',
  },
];
