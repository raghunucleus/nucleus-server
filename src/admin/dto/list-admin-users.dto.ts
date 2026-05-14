import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ADMIN_USERS_SORT_FIELDS = [
  'name',
  'email',
  'username',
  'role',
  'status',
  'created_at',
] as const;

export type AdminUsersSortField = (typeof ADMIN_USERS_SORT_FIELDS)[number];

const optionalSearchString = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ListAdminUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: optionalSearchString,
  sortBy: z.enum(ADMIN_USERS_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  // Per-column search: each narrows the corresponding column independently.
  nameSearch: optionalSearchString,
  emailSearch: optionalSearchString,
  usernameSearch: optionalSearchString,
  mobileSearch: optionalSearchString,
  // Filter panel selections.
  status: z.enum(['active', 'inactive']).optional(),
  role: z.enum(['master', 'admin']).optional(),
});

export class ListAdminUsersDto extends createZodDto(ListAdminUsersSchema) {}
