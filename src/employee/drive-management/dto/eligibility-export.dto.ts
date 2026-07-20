import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { StudentSearchSchema } from '../../../student-query/dto/student-search.dto';

/**
 * Same ceiling as the drive Students tab export dialog. The engine's own 40
 * limit bounds `columns` (the on-screen table) as a request-schema guard, not
 * the query — a wider sheet just selects more expressions.
 */
const MAX_EXPORT_COLUMNS = 60;

/**
 * The eligibility-check export body: a normal student search plus the sheet's
 * own column layout.
 *
 * `export_columns` is ORDER-SIGNIFICANT and independent of `columns` (which
 * drives the on-screen table): the export dialog lets the user pick and reorder
 * a different set. The engine always resolves `columns` with the implicit keys
 * (`id`, `student_id`, `display_name`) first and in its own order, so the file
 * layout can't be expressed through it — the service reorders the resolved rows
 * against this array instead. Omit it and the export behaves exactly as before.
 */
export const EligibilityExportSchema = StudentSearchSchema.extend({
  export_columns: z
    .array(z.string().trim().min(1).max(64))
    .max(MAX_EXPORT_COLUMNS)
    .optional(),
});

export class EligibilityExportDto extends createZodDto(
  EligibilityExportSchema,
) {}
