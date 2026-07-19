import { createZodDto } from 'nestjs-zod';
import { DriveQuerySchema, queryIdArray } from './drive.dto';

/**
 * The coordinator drive list's filters — the manage-screen filter set plus the
 * two scope facets. `programme_ids` / `passout_years` can only NARROW the
 * coordinator's RBAC scope: the service intersects them with the accessible
 * values and ignores anything outside it (see
 * PlacementCoordinatorDrivesService.clamp).
 */
export const CoordinatorDriveQuerySchema = DriveQuerySchema.extend({
  programme_ids: queryIdArray,
  // Bare graduating years (e.g. 2027) — queryIdArray only requires positive
  // integers, which years are.
  passout_years: queryIdArray,
});
export class CoordinatorDriveQueryDto extends createZodDto(
  CoordinatorDriveQuerySchema,
) {}
