import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Trimmed, nullable, optional string — empty string collapses to null so the
// client can clear a field by sending "".
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const UpdateInstitutionSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    short_name: optionalText(64),
    address_line1: optionalText(256),
    address_line2: optionalText(256),
    city: optionalText(128),
    state: optionalText(128),
    pincode: optionalText(16),
    logo_url: z
      .string()
      .trim()
      .max(2048)
      .url('logo_url must be a valid URL')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    affiliation_code: optionalText(128),
    aicte_code: optionalText(128),
    naac_grade: optionalText(32),
    card_footer_note: optionalText(256),
  })
  .strict();

export class UpdateInstitutionSettingsDto extends createZodDto(
  UpdateInstitutionSettingsSchema,
) {}
