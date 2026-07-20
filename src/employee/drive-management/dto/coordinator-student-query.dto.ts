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

/**
 * The "ask this student to update their profile" body. `field_keys` are
 * profile-field registry keys (validated against the registry in the service,
 * not here, so the error names the offending key); an empty list is allowed —
 * the coordinator may just want to send a message.
 *
 * At least one channel must be on, otherwise the send is a no-op the
 * coordinator would be told succeeded.
 */
export const NotifyStudentSchema = z
  .object({
    field_keys: z.array(z.string().min(1)).max(80).default([]),
    message: z.string().trim().min(1).max(1000),
    channels: z
      .object({
        in_app: z.boolean().default(false),
        push: z.boolean().default(false),
        email: z.boolean().default(false),
      })
      .strict()
      .refine(
        (c) => c.in_app || c.push || c.email,
        'Pick at least one delivery channel.',
      ),
  })
  .strict();
export class NotifyStudentDto extends createZodDto(NotifyStudentSchema) {}
