import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const NoteSchema = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((v) => (v ? v : undefined));

// Approve/reject body — an optional note shown to the requester. An empty
// string collapses to "no note".
export const DecisionSchema = z
  .object({
    note: NoteSchema,
  })
  .strict();

export class DecisionDto extends createZodDto(DecisionSchema) {}

// Per-item (mixed) decision body — item keys are type-specific (e.g. profile
// field names) and validated by the type handler; the framework only owns the
// verdict vocabulary. `overall` is the approver's pick for the request status
// when verdicts disagree (required then — enforced by the handler; ignored
// when verdicts are uniform).
export const DecideSchema = z
  .object({
    decisions: z
      .record(z.string(), z.enum(['approved', 'rejected']))
      .refine(
        (d) => Object.keys(d).length > 0,
        'Provide a verdict for at least one item',
      ),
    overall: z.enum(['approved', 'rejected']).optional(),
    note: NoteSchema,
  })
  .strict();

export class DecideDto extends createZodDto(DecideSchema) {}

// Send-back body. Unlike a decision, the note is REQUIRED — the whole point is
// telling the requester what to change, and a blank send-back would strand
// them with no way to know what to fix.
export const SendBackSchema = z
  .object({
    note: z
      .string()
      .trim()
      .min(1, 'Tell the requester what to change')
      .max(1000),
  })
  .strict();

export class SendBackDto extends createZodDto(SendBackSchema) {}
