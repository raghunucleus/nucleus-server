import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The upper bound on a single record-level / batch import call. */
export const MAX_IMPORT_STUDENT_IDS = 5000;

/**
 * Record-level (or small batch) import: the explicit student ids the Filter tab
 * picked. "Import all matched" does NOT go through here — it posts the search
 * body to `import-all` so the server can re-derive the id set from the filters.
 */
export const ImportDriveStudentsSchema = z.object({
  student_ids: z
    .array(z.coerce.number().int().positive())
    .min(1)
    .max(MAX_IMPORT_STUDENT_IDS),
});

export class ImportDriveStudentsDto extends createZodDto(
  ImportDriveStudentsSchema,
) {}
