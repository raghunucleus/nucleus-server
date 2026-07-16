import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { optionalSearchString } from './address-attribute-fields.dto';

export const COUNTRIES_SORT_FIELDS = [
  'name',
  'iso2',
  'iso3',
  'status',
  'created_at',
  'updated_at',
] as const;

export type CountriesSortField = (typeof COUNTRIES_SORT_FIELDS)[number];

export const ListCountriesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(COUNTRIES_SORT_FIELDS).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  nameSearch: optionalSearchString,
  iso2Search: optionalSearchString,
  status: z.enum(['active', 'inactive']).optional(),
});

export class ListCountriesDto extends createZodDto(ListCountriesSchema) {}
