import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SetProfileVerifiersSchema = z
  .object({
    // Employees picked as this batch's profile verifiers — at least one
    // required. Duplicates are collapsed.
    profile_verifier_employee_ids: z
      .array(z.coerce.number().int().positive())
      .min(1, 'Pick at least one profile verifier')
      .transform((ids) => Array.from(new Set(ids))),
  })
  .strict();

export class SetProfileVerifiersDto extends createZodDto(
  SetProfileVerifiersSchema,
) {}
