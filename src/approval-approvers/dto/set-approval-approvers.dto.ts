import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SetApprovalApproversSchema = z
  .object({
    // The complete approver set for the action — this is a wholesale replace,
    // not an append. Duplicates are collapsed. An empty array is legal and
    // clears every approver (the action then has nobody to sign off).
    employee_ids: z
      .array(z.coerce.number().int().positive())
      .transform((ids) => Array.from(new Set(ids))),
  })
  .strict();

export class SetApprovalApproversDto extends createZodDto(
  SetApprovalApproversSchema,
) {}
