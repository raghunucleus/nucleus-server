import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Ask to cancel an approved leave — goes to the same in-charges for approval. */
export const RequestLeaveCancelSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
  })
  .strict();

export class RequestLeaveCancelDto extends createZodDto(
  RequestLeaveCancelSchema,
) {}
