import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ACADEMIC_LEVELS } from '../entities/degree.entity';

export const DEGREES_SORT_FIELDS = [
  'name',
  'code',
  'short_name',
  'academic_level',
  'duration_years',
  'status',
  'created_at',
  'updated_at',
] as const;

export type DegreesSortField = (typeof DEGREES_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListDegreesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(DEGREES_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  nameSearch: optionalSearchString,
  codeSearch: optionalSearchString,
  shortNameSearch: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
  academicLevel: z.enum(ACADEMIC_LEVELS).optional(),
});

export class ListDegreesDto extends createZodDto(ListDegreesSchema) {}
