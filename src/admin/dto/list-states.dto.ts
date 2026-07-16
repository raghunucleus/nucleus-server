import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  optionalEffectiveActive,
  optionalParentId,
  optionalSearchString,
} from './address-attribute-fields.dto';

export const STATES_SORT_FIELDS = [
  'name',
  'lgd_code',
  'iso_code',
  'country',
  'status',
  'created_at',
  'updated_at',
] as const;

export type StatesSortField = (typeof STATES_SORT_FIELDS)[number];

export const ListStatesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(STATES_SORT_FIELDS).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  countryId: optionalParentId,
  nameSearch: optionalSearchString,
  lgdCodeSearch: optionalSearchString,
  isoCodeSearch: optionalSearchString,
  // The row's own is_active — what the management screen filters on.
  status: z.enum(['active', 'inactive']).optional(),
  // The whole ancestor chain (state AND country active) — what a consumer
  // picker wants. Wins over `status` if both are sent.
  effectiveActive: optionalEffectiveActive,
});

export class ListStatesDto extends createZodDto(ListStatesSchema) {}
