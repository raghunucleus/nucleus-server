import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Whitelisted sort fields — column names callers can ask the server to sort by. */
export const ROLE_SORT_FIELDS = [
  'code',
  'name',
  'is_active',
  'created_at',
  'updated_at',
] as const;
export type RoleSortField = (typeof ROLE_SORT_FIELDS)[number];

export const ListRolesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  name: z.string().trim().min(1).max(128).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sortBy: z.enum(ROLE_SORT_FIELDS).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export class ListRolesDto extends createZodDto(ListRolesSchema) {}
