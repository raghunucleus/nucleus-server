import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { HIDEABLE_PROFILE_FIELDS } from '../../../common/profile-privacy';

/**
 * Body of PUT /student/profile/privacy — the full set of personal fields the
 * student wants hidden from peers. Absent/empty = nothing hidden (all visible).
 * Validated against the canonical hideable key set; duplicates are collapsed.
 */
export const UpdateProfilePrivacySchema = z.object({
  hidden: z
    .array(z.enum(HIDEABLE_PROFILE_FIELDS))
    .default([])
    .transform((keys) => [...new Set(keys)]),
});

export class UpdateProfilePrivacyDto extends createZodDto(
  UpdateProfilePrivacySchema,
) {}
