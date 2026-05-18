import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PROGRAMME_SEMESTERS_SORT_FIELDS = [
  'programme',
  'admission_year',
  'semester',
  'status',
  'created_at',
  'updated_at',
] as const;

export type ProgrammeSemestersSortField =
  (typeof PROGRAMME_SEMESTERS_SORT_FIELDS)[number];

export const ListProgrammeSemestersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(PROGRAMME_SEMESTERS_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  status: z.enum(['active', 'inactive']).optional(),
  programmeId: z.coerce.number().int().positive().optional(),
  admissionYearId: z.coerce.number().int().positive().optional(),
  semesterId: z.coerce.number().int().positive().optional(),
});

export class ListProgrammeSemestersDto extends createZodDto(
  ListProgrammeSemestersSchema,
) {}
