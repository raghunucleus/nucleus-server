import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ListAttendanceGroupsSchema = z.object({
  programmeId: z.coerce.number().int().positive(),
  admissionYearId: z.coerce.number().int().positive(),
});

export class ListAttendanceGroupsDto extends createZodDto(
  ListAttendanceGroupsSchema,
) {}
