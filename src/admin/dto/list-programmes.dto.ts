import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PROGRAMMES_SORT_FIELDS = [
  'name',
  'code',
  'display_name',
  'degree',
  'department',
  'status',
  'created_at',
  'updated_at',
] as const;

export type ProgrammesSortField = (typeof PROGRAMMES_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListProgrammesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(PROGRAMMES_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  nameSearch: optionalSearchString,
  codeSearch: optionalSearchString,
  displayNameSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
  degreeId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
});

export class ListProgrammesDto extends createZodDto(ListProgrammesSchema) {}
