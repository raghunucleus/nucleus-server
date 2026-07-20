import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Matches the student-query engine's own column ceiling, plus headroom for
 *  the drive's lifecycle columns. */
const MAX_EXPORT_COLUMNS = 60;

/**
 * A Students tab export request.
 *
 * The filter fields mirror the list endpoint's query params exactly — the
 * client replays its current filter state so the file matches the screen. They
 * live in the body rather than the query string because this is a POST.
 *
 * `columns` is ORDER-SIGNIFICANT: the array is the sheet's column layout, left
 * to right. Omit it for the default shortlist columns.
 */
export const ExportDriveStudentsSchema = z.object({
  columns: z.array(z.string().trim().min(1)).max(MAX_EXPORT_COLUMNS).optional(),
  format: z.enum(['csv', 'xlsx']),
  search: z.string().trim().max(200).optional(),
  status: z.coerce.number().int().optional(),
  programme_ids: z.array(z.coerce.number().int().positive()).optional(),
  passout_years: z.array(z.coerce.number().int()).optional(),
  entry_type: z.coerce
    .number()
    .int()
    .refine((v) => v === 1 || v === 2, {
      message: 'entry_type must be 1 (Regular) or 2 (Lateral)',
    })
    .optional(),
});

export class ExportDriveStudentsDto extends createZodDto(
  ExportDriveStudentsSchema,
) {}
