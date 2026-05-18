import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SEMESTERS_SORT_FIELDS = [
  'sem_number',
  'code',
  'name',
  'year_sem_format',
  'roman_format',
  'status',
  'created_at',
  'updated_at',
] as const;

export type SemestersSortField = (typeof SEMESTERS_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListSemestersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(SEMESTERS_SORT_FIELDS).default('sem_number'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  semNumberSearch: optionalSearchString,
  codeSearch: optionalSearchString,
  nameSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
});

export class ListSemestersDto extends createZodDto(ListSemestersSchema) {}
