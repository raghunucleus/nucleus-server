import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  optionalEffectiveActive,
  optionalParentId,
  optionalSearchString,
} from './address-attribute-fields.dto';

export const DISTRICTS_SORT_FIELDS = [
  'name',
  'lgd_code',
  'state',
  'country',
  'status',
  'created_at',
  'updated_at',
] as const;

export type DistrictsSortField = (typeof DISTRICTS_SORT_FIELDS)[number];

export const ListDistrictsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(DISTRICTS_SORT_FIELDS).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
  // countryId filters through the state join, so "all districts in India" is a
  // valid query without picking a state.
  countryId: optionalParentId,
  stateId: optionalParentId,
  nameSearch: optionalSearchString,
  lgdCodeSearch: optionalSearchString,
  // The row's own is_active — what the management screen filters on. It does
  // NOT consider the parent state/country, so an "active" district here may
  // still sit under an inactive state; that is deliberate, so admins can find
  // and fix such rows.
  status: z.enum(['active', 'inactive']).optional(),
  // The whole ancestor chain (district AND state AND country active) — what a
  // consumer picker wants. Wins over `status` if both are sent.
  effectiveActive: optionalEffectiveActive,
});

export class ListDistrictsDto extends createZodDto(ListDistrictsSchema) {}
