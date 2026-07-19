import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_IMPORT_STUDENT_IDS } from './import-drive-students.dto';
import {
  refineSelectionPackage,
  SelectionPackageShape,
} from './selection-package.schema';

/**
 * Drive-day outcome for ACCEPTED (30) students: 50 Not Attended, 60 Selected,
 * 70 Not Selected. Literals rather than z.number() so an unknown code is a 400,
 * not a silently-stored garbage status.
 *
 * A Selected (60) outcome must also carry the selection details — the
 * designation and the package amounts, one set applied to the whole batch.
 * Whether CTC and/or stipend is required depends on the effective offer type's
 * flags, which the service checks; the DTO enforces presence/shape only.
 */
export const MarkDriveStudentOutcomeSchema = z
  .object({
    student_ids: z
      .array(z.coerce.number().int().positive())
      .min(1)
      .max(MAX_IMPORT_STUDENT_IDS),
    status: z.union([z.literal(50), z.literal(60), z.literal(70)]),
    ...SelectionPackageShape,
    drive_profile_id: SelectionPackageShape.drive_profile_id.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 60) {
      if (v.drive_profile_id == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['drive_profile_id'],
          message: 'A Selected outcome needs the designation.',
        });
      }
    } else if (
      v.drive_profile_id != null ||
      v.ctc != null ||
      v.ctc_min != null ||
      v.stipend != null ||
      v.stipend_min != null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Designation and amounts only apply to a Selected outcome.',
      });
    }
    refineSelectionPackage(v, ctx);
  });

export class MarkDriveStudentOutcomeDto extends createZodDto(
  MarkDriveStudentOutcomeSchema,
) {}
