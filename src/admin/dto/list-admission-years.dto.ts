import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ADMISSION_YEARS_SORT_FIELDS = [
  'year',
  'display_year',
  'status',
  'created_at',
  'updated_at',
] as const;

export type AdmissionYearsSortField = (typeof ADMISSION_YEARS_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListAdmissionYearsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(ADMISSION_YEARS_SORT_FIELDS).default('year'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  yearSearch: optionalSearchString,
  displayYearSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
});

export class ListAdmissionYearsDto extends createZodDto(ListAdmissionYearsSchema) {}
