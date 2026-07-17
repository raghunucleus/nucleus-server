import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { GUARDIAN_RELATIONSHIPS } from '../../guardian/entities/student-guardian.entity';

const emailSchema = z
  .union([z.string().trim().max(255).email(), z.literal(''), z.null()])
  .optional()
  .transform((v): string | null | undefined =>
    v === undefined
      ? undefined
      : v === '' || v === null
        ? null
        : v.toLowerCase(),
  );

// Edit a guardian contact in place. The owning student cannot change (delete +
// re-create to move a contact).
export const UpdateGuardianSchema = z
  .object({
    relationship: z.enum(GUARDIAN_RELATIONSHIPS).optional(),
    name: z.string().trim().min(1).max(128).optional(),
    mobile_number: z
      .string()
      .trim()
      .regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number')
      .optional(),
    email: emailSchema,
    is_primary: z.coerce.boolean().optional(),
  })
  .strict();

export class UpdateGuardianDto extends createZodDto(UpdateGuardianSchema) {}
