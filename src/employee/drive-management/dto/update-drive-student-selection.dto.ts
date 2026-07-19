import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  refineSelectionPackage,
  SelectionPackageShape,
} from './selection-package.schema';

/**
 * Edit the designation/package recorded on a Selected (60) drive-student —
 * fixing a mistake or updating after the offer letter. Full replacement, same
 * validation as marking Selected; the service re-checks the offer-type rules.
 */
export const UpdateDriveStudentSelectionSchema = z
  .object(SelectionPackageShape)
  .superRefine(refineSelectionPackage);

export class UpdateDriveStudentSelectionDto extends createZodDto(
  UpdateDriveStudentSelectionSchema,
) {}
