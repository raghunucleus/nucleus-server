import { Workbook } from 'exceljs';
import { ATTRIBUTE_BY_KEY } from './registry/student-attributes';
import { AttributeDef } from './registry/types';

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

function labelOf(key: string): string {
  return IMPLICIT_LABELS[key] ?? ATTRIBUTE_BY_KEY.get(key)?.label ?? key;
}

function displayValue(key: string, value: unknown): string | number {
  if (value === null || value === undefined) return '';
  const def: AttributeDef | undefined = ATTRIBUTE_BY_KEY.get(key);
  if (def?.enumLabels) {
    const label = def.enumLabels[value as string | number];
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
): Buffer {
  const lines = [columns.map((c) => csvCell(labelOf(c))).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(displayValue(c, row[c]))).join(','));
  }
  // UTF-8 BOM so Excel detects the encoding.
  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(lines.join('\r\n') + '\r\n', 'utf8'),
  ]);
}

export async function rowsToXlsx(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet('Students');
  ws.columns = columns.map((c) => ({
    header: labelOf(c),
    key: c,
    width: Math.min(40, Math.max(12, labelOf(c).length + 4)),
  }));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    ws.addRow(
      Object.fromEntries(columns.map((c) => [c, displayValue(c, row[c])])),
    );
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function exportFilename(ext: 'csv' | 'xlsx'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `students-${stamp}.${ext}`;
}
