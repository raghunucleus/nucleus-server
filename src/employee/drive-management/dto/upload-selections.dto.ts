import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_IMPORT_STUDENT_IDS } from './import-drive-students.dto';

/**
 * A bulk "Selected students" sheet, one designation at a time.
 *
 * EVERY CELL IS A TRIMMED STRING ON PURPOSE — the same convention the exam-marks
 * upload uses. A sheet's problems are per-cell ("that roll isn't in this drive",
 * "that stipend isn't a number") and the client renders them against the grid it
 * is showing; coercing here would collapse all of that into one opaque Zod 400.
 * The only structurally-typed field is the designation, which the UI picks from
 * a list rather than the user typing it.
 *
 * Preview and commit share this schema: there is no staging table and no upload
 * session. A drive's selected list is realistically tens-to-hundreds of rows, so
 * the client simply re-posts the (possibly edited) rows to commit and the server
 * re-runs the identical validator — the preview's verdict is never trusted.
 */
export const UploadSelectionsSchema = z
  .object({
    /** The designation every row in this sheet was selected for. */
    drive_profile_id: z.coerce.number().int().positive(),
    rows: z
      .array(
        z
          .object({
            roll_number: z.string().trim().max(64).optional(),
            ctc: z.string().trim().max(32).optional(),
            ctc_min: z.string().trim().max(32).optional(),
            stipend: z.string().trim().max(32).optional(),
            stipend_min: z.string().trim().max(32).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_IMPORT_STUDENT_IDS),
  })
  .strict();

export class UploadSelectionsDto extends createZodDto(UploadSelectionsSchema) {}

export type UploadSelectionRow = z.infer<
  typeof UploadSelectionsSchema
>['rows'][number];
