import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Both filters are optional, but a caller almost always scopes by
// programmeSemesterId — the timetables screen lists one semester at a time.
export const ListTimetablesSchema = z
  .object({
    programmeSemesterId: z.coerce.number().int().positive().optional(),
    attendanceGroupId: z.coerce.number().int().positive().optional(),
  })
  .strict();

export class ListTimetablesDto extends createZodDto(ListTimetablesSchema) {}
