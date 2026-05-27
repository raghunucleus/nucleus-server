import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Only the new template's name is needed — the clone inherits group,
// programme_semester, periods, courses and cells from its source.
export const CloneTimetableSchema = z
  .object({
    name: z.string().trim().min(1).max(96),
  })
  .strict();

export class CloneTimetableDto extends createZodDto(CloneTimetableSchema) {}
