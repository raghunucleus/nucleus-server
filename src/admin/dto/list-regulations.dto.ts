import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const REGULATIONS_SORT_FIELDS = [
  'name',
  'code',
  'year_of_regulation',
  'status',
  'created_at',
  'updated_at',
] as const;

export type RegulationsSortField = (typeof REGULATIONS_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListRegulationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(REGULATIONS_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  nameSearch: optionalSearchString,
  codeSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
});

export class ListRegulationsDto extends createZodDto(ListRegulationsSchema) {}
