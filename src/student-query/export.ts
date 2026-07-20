import { Workbook } from 'exceljs';
import { ATTRIBUTE_BY_KEY } from './registry/student-attributes';

/**
 * Serialize search rows to CSV / XLSX for the `format` request option.
 * Headers are the registry labels; enum values are rendered through
 * enumLabels; multi-value columns (string[]) are joined with '; '.
 */

const IMPLICIT_LABELS: Record<string, string> = {
  id: 'ID',
  student_id: 'Roll number',
  display_name: 'Full name',
};

/**
 * Describes a column the student registry doesn't know about — the drive
 * Students tab export mixes `drive.*` lifecycle columns into the same sheet.
 * Keyed by column key; registry keys resolve themselves and need no entry.
 */
export interface ColumnMeta {
  label: string;
  kind?: string;
  enumLabels?: Readonly<Record<string | number, string>>;
  /** Short click-through text for `link` columns, e.g. 'Resume'. */
  linkText?: string;
}

export type ColumnMetaMap = ReadonlyMap<string, ColumnMeta>;

function labelOf(key: string, meta?: ColumnMetaMap): string {
  return (
    meta?.get(key)?.label ??
    IMPLICIT_LABELS[key] ??
    ATTRIBUTE_BY_KEY.get(key)?.label ??
    key
  );
}

function kindOf(key: string, meta?: ColumnMetaMap): string | undefined {
  return meta?.get(key)?.kind ?? ATTRIBUTE_BY_KEY.get(key)?.kind;
}

function displayValue(
  key: string,
  value: unknown,
  meta?: ColumnMetaMap,
): string | number {
  if (value === null || value === undefined) return '';
  const enumLabels =
    meta?.get(key)?.enumLabels ?? ATTRIBUTE_BY_KEY.get(key)?.enumLabels;
  if (enumLabels) {
    const label = enumLabels[value as string | number];
    if (label !== undefined) return label;
  }
  if (Array.isArray(value)) return value.join('; ');
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value;
  return String(value);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  meta?: ColumnMetaMap,
): Buffer {
  const lines = [columns.map((c) => csvCell(labelOf(c, meta))).join(',')];
  for (const row of rows) {
    // A hyperlink isn't representable in CSV — link columns carry the raw URL.
    lines.push(
      columns.map((c) => csvCell(displayValue(c, row[c], meta))).join(','),
    );
  }
  // UTF-8 BOM so Excel detects the encoding.
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(lines.join('\r\n') + '\r\n', 'utf8'),
  ]);
}

/** Excel's default hyperlink blue, so link cells read as links. */
const LINK_FONT = { color: { argb: 'FF0563C1' }, underline: true } as const;
const LINK_COLUMN_WIDTH = 14;

export async function rowsToXlsx(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  meta?: ColumnMetaMap,
): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet('Students');
  const linkCols = new Set(columns.filter((c) => kindOf(c, meta) === 'link'));
  ws.columns = columns.map((c) => {
    const label = labelOf(c, meta);
    return {
      header: label,
      key: c,
      // Link cells show a short label, not the URL — a URL-derived width would
      // leave a column of mostly empty space.
      width: linkCols.has(c)
        ? LINK_COLUMN_WIDTH
        : Math.min(40, Math.max(12, label.length + 4)),
    };
  });
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    const added = ws.addRow(
      Object.fromEntries(
        columns.map((c) => [
          c,
          linkCols.has(c) ? '' : displayValue(c, row[c], meta),
        ]),
      ),
    );
    // Link columns become real hyperlink cells: the sheet shows a short label
    // ('Resume') and clicking it opens the URL, so a long link never blows out
    // the column. Empty stays empty — no dead links.
    for (const c of linkCols) {
      const url = row[c];
      if (typeof url !== 'string' || url.length === 0) continue;
      const cell = added.getCell(c);
      cell.value = { text: meta?.get(c)?.linkText ?? 'Open', hyperlink: url };
      cell.font = { ...LINK_FONT };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function exportFilename(ext: 'csv' | 'xlsx'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `students-${stamp}.${ext}`;
}
