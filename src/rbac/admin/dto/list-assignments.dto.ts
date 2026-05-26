import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Whitelisted sort fields. `employee` / `role` are aliases for the joined
 * display columns the service maps to `employee.emp_display_name` and
 * `role.name` respectively.
 */
export const ASSIGNMENT_SORT_FIELDS = [
  'employee',
  'role',
  'created_at',
  'updated_at',
] as const;
export type AssignmentSortField = (typeof ASSIGNMENT_SORT_FIELDS)[number];

export const ListAssignmentsSchema = z.object({
  employee_id: z.coerce.number().int().positive().optional(),
  role_id: z.coerce.number().int().positive().optional(),
  // Free-text search over employee name/code and role name/code.
  q: z.string().trim().min(1).max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(ASSIGNMENT_SORT_FIELDS).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export class ListAssignmentsDto extends createZodDto(ListAssignmentsSchema) {}
