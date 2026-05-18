import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PROGRAMME_SEMESTER_SUBJECTS_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'credits',
  'status',
] as const;

export type ProgrammeSemesterSubjectsSortField =
  (typeof PROGRAMME_SEMESTER_SUBJECTS_SORT_FIELDS)[number];

export const ListProgrammeSemesterSubjectsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  sortBy: z
    .enum(PROGRAMME_SEMESTER_SUBJECTS_SORT_FIELDS)
    .default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  status: z.enum(['active', 'inactive']).optional(),
  programmeSemesterId: z.coerce.number().int().positive().optional(),
});

export class ListProgrammeSemesterSubjectsDto extends createZodDto(
  ListProgrammeSemesterSubjectsSchema,
) {}
