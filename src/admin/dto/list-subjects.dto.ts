import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SUBJECTS_SORT_FIELDS = [
  'code',
  'name',
  'status',
  'created_at',
  'updated_at',
] as const;

export type SubjectsSortField = (typeof SUBJECTS_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

// regulationId is optional in the DTO so the endpoint stays general-purpose,
// but the admin UI enforces a regulation selection before listing.
export const ListSubjectsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(SUBJECTS_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  codeSearch: optionalSearchString,
  nameSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
  regulationId: z.coerce.number().int().positive().optional(),
  subjectTypeId: z.coerce.number().int().positive().optional(),
});

export class ListSubjectsDto extends createZodDto(ListSubjectsSchema) {}
