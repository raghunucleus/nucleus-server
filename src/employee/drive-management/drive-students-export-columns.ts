import { ColumnMeta } from '../../student-query/export';
import { DRIVE_STUDENT_STATUS_LABELS } from './drive-student-status';

/**
 * The drive-specific half of the Students tab export catalog.
 *
 * The other half is the whole student-query attribute registry, so keys here
 * are namespaced `drive.` — a drive column can never collide with a student
 * attribute, and the export service splits a requested column list on that
 * prefix to decide which engine resolves it.
 *
 * Every entry maps to an alias the Students tab list query already selects;
 * this file adds labels and display semantics, not new SQL.
 */
export interface DriveExportColumn {
  /** Wire key, always `drive.`-prefixed. */
  key: string;
  label: string;
  /** Drives serialization: enum → label lookup, date → ISO, link → hyperlink. */
  kind: 'string' | 'number' | 'date' | 'enum' | 'link';
  /** The raw alias produced by the list query. */
  raw: string;
  enumLabels?: Readonly<Record<string | number, string>>;
}

export const DRIVE_EXPORT_GROUP = { key: 'drive', label: 'Drive' } as const;

export const DRIVE_EXPORT_COLUMNS: readonly DriveExportColumn[] = [
  {
    key: 'drive.status',
    label: 'Status',
    kind: 'enum',
    raw: 'status',
    enumLabels: DRIVE_STUDENT_STATUS_LABELS,
  },
  {
    key: 'drive.imported_at',
    label: 'Imported at',
    kind: 'date',
    raw: 'imported_at',
  },
  {
    key: 'drive.imported_by',
    label: 'Imported by',
    kind: 'string',
    raw: 'imported_by',
  },
  {
    key: 'drive.invited_at',
    label: 'Invited at',
    kind: 'date',
    raw: 'invited_at',
  },
  {
    key: 'drive.responded_at',
    label: 'Responded at',
    kind: 'date',
    raw: 'responded_at',
  },
  {
    // One column carries both the student's denial reason and the placement
    // cell's revoke reason — the entity reuses the field, and which one it is
    // is unambiguous from the Status column beside it.
    key: 'drive.rejection_reason',
    label: 'Reason',
    kind: 'string',
    raw: 'rejection_reason',
  },
  {
    key: 'drive.outcome_marked_at',
    label: 'Outcome marked at',
    kind: 'date',
    raw: 'outcome_marked_at',
  },
  {
    key: 'drive.selected_designation',
    label: 'Selected designation',
    kind: 'string',
    raw: 'selected_designation',
  },
  { key: 'drive.ctc', label: 'CTC', kind: 'number', raw: 'ctc' },
  { key: 'drive.ctc_min', label: 'CTC (min)', kind: 'number', raw: 'ctc_min' },
  { key: 'drive.stipend', label: 'Stipend', kind: 'number', raw: 'stipend' },
  {
    key: 'drive.stipend_min',
    label: 'Stipend (min)',
    kind: 'number',
    raw: 'stipend_min',
  },
];

export const DRIVE_EXPORT_COLUMN_BY_KEY = new Map(
  DRIVE_EXPORT_COLUMNS.map((c) => [c.key, c]),
);

export const DRIVE_EXPORT_KEY_PREFIX = 'drive.';

/**
 * What the picker starts with — the on-screen table's columns plus both resume
 * links, which are the whole point of exporting a shortlist.
 */
export const DEFAULT_DRIVE_EXPORT_COLUMNS: readonly string[] = [
  'student_id',
  'display_name',
  'programme',
  'pass_out_year',
  'drive.status',
  'resume_nucleus_url',
  'resume_external_url',
];

/** Serialization metadata for the drive half of a mixed column list. */
export function driveColumnMeta(): Map<string, ColumnMeta> {
  return new Map(
    DRIVE_EXPORT_COLUMNS.map((c) => [
      c.key,
      { label: c.label, kind: c.kind, enumLabels: c.enumLabels },
    ]),
  );
}
