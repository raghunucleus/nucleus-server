import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The inline toggle's body — tri-state, null meaning "not decided". Matches
 * the admin student editor, which also distinguishes "not allowed" from
 * "nobody has decided yet".
 *
 * Filtering lives in the student query engine now (see
 * PlacementCoordinatorStudentsSearchService), so there is no list-query DTO
 * here; the batch arrives as a query param on each route.
 */
export const SetAllowedForPlacementsSchema = z
  .object({
    allowed: z.union([z.boolean(), z.null()]),
  })
  .strict();
export class SetAllowedForPlacementsDto extends createZodDto(
  SetAllowedForPlacementsSchema,
) {}
