import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const GUARDIANS_SORT_FIELDS = [
  'name',
  'mobile_number',
  'relationship',
  'created_at',
  'updated_at',
] as const;

export type GuardiansSortField = (typeof GUARDIANS_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListGuardiansSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(GUARDIANS_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  nameSearch: optionalSearchString,
  mobileSearch: optionalSearchString,
  studentSearch: optionalSearchString,
});

export class ListGuardiansDto extends createZodDto(ListGuardiansSchema) {}
